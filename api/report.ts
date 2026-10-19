// Vercel Edge Function: error reports from visitors' browsers (services/errorReporter.ts).
//
// Each report is written to the server log. When RESEND_API_KEY (a Resend API key with "Sending
// access") and REPORTS_EMAIL (where alerts go) are set, a new kind of error is also emailed
// (services/alertEmail.ts); the same error again at most every 6 hours per server instance, saying how
// many times it was seen since, under the same subject, so a mail client keeps them in one thread. A
// report holds the error, where in the code, the page's path and the build, and nothing else from the page.
//
// Anything can post here, a script included (the origin check only stops other websites' pages), so
// the alerts have one limit for the whole site: ALERTS_PER_HOUR emails an hour, however many server
// instances share the work. The instances share no store, so Resend keeps the count: each hour has
// numbered slots, an email goes out under its slot's idempotency key, and Resend never sends twice under
// one key (another email under a used key is refused with 409), so each slot is used once at most, by
// whichever instance asks first. The key names the site by its production domain, not by the address a
// report came in on, so asking another of the deployment's addresses doesn't buy another count.

import { alertEmail, ALERTS_PER_HOUR, REPEAT_HOURS, type AlertEmail, type AlertReport } from '../services/alertEmail';
import { readBody } from '../services/requestBody';

export const config = { runtime: 'edge' };

// Same origins as /api/analyze: other websites can't file reports from their pages
const ALLOWED_ORIGINS = new Set<string>([
  // Any other address the app is served from goes here (the page's own address always passes)
]);

const MAX_BODY_CHARS = 4000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REPORTS = 10; // Per visitor per minute; a page sends at most five
const EMAIL_TIMEOUT_MS = 5000;
const REPEAT_EMAIL_MS = REPEAT_HOURS * 60 * 60_000; // The same error again: one email every 6 hours at most
const PAUSE_MS = 60_000; // After Resend refuses an email or can't be reached: a minute before this instance asks again
// Resend's shared sender: without a domain of your own there, it delivers only to the address you signed up with
const SENDER = 'Argus alerts <onboarding@resend.dev>';
const EMAIL_ADDRESS = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
const PAGE = /^\/[\w\-.~!$&'()*+,;=:@%\/]*$/; // What a browser's location.pathname can hold
const BUILD = /^[\w.-]+$/; // A commit, or "local"

const recentReports = new Map<string, number[]>();
const emailed = new Map<string, { at: number; since: number }>(); // Fingerprint -> its last email, and reports of it since
const sending = new Map<string, number>(); // Fingerprint -> reports of it that came in while its email was on its way
let slots = { hour: '', next: 0 }; // This hour's first slot this instance hasn't seen used
let heldBack = 0; // Reports this instance didn't email since its last alert
let pausedUntil = 0;

// Plain text of a bounded length: no control characters
const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').slice(0, max) : '';

function tooMany(visitor: string): boolean {
  const now = Date.now();
  const recent = (recentReports.get(visitor) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX_REPORTS) return true;
  recent.push(now);
  recentReports.set(visitor, recent);
  if (recentReports.size > 5000) {
    for (const [key, times] of recentReports) if (times.every(t => now - t >= RATE_WINDOW_MS)) recentReports.delete(key);
  }
  return false;
}

/** The same fault, whatever the build: the message with its numbers blurred, and the function it happened in. */
async function fingerprint(report: AlertReport): Promise<string> {
  const where = report.stack.split('\n')[0]?.replace(/\(.*$|@.*$|:\d+:\d+.*$/, '').trim() || report.source.replace(/:\d+(:\d+)?$/, '');
  const data = new TextEncoder().encode(`${report.message.replace(/\d+/g, '#')}|${where}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** One email through Resend under an idempotency key; null when Resend couldn't be reached in time. */
async function send(email: AlertEmail, idempotencyKey: string, key: string, to: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'argus-error-reports', 'Idempotency-Key': idempotencyKey },
      // The same subject for the same fault, so its emails stay in one thread
      body: JSON.stringify({ from: SENDER, to, subject: email.subject, html: email.html, text: email.text }),
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 409) {
      const reason = await res.json().then((body: any) => (typeof body?.message === 'string' ? `: ${body.message.slice(0, 200)}` : ''), () => '');
      console.error(`[report] Resend ${res.status}${reason}`);
    }
    return res;
  } catch {
    console.error('[report] Resend could not be reached in time');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Emails a report through Resend: each kind of error once, then at most every 6 hours, within the site's
 * alerts for the hour. An email that doesn't go out isn't counted as sent, so the next report of it tries again.
 */
async function toEmail(report: AlertReport, id: string, site: URL, key: string, to: string): Promise<void> {
  const now = Date.now();
  const last = emailed.get(id);
  if (last && now - last.at < REPEAT_EMAIL_MS) {
    last.since += 1;
    return;
  }
  const pending = sending.get(id);
  if (pending !== undefined) {
    sending.set(id, pending + 1);
    return;
  }
  const hold = () => {
    heldBack += 1;
    if (last) last.since += 1;
  };
  const hour = new Date(now).toISOString().slice(0, 13); // "2026-10-10T13", in UTC
  if (slots.hour !== hour) slots = { hour, next: 0 };
  const budget = slots;
  if (now < pausedUntil || budget.next >= ALERTS_PER_HOUR) return hold();

  sending.set(id, 0);
  try {
    const held = heldBack;
    const email = alertEmail(report, { id, at: now, origin: site.origin, heldBack: held, ...(last ? { repeat: { times: last.since + 1, since: last.at } } : {}) });
    while (budget.next < ALERTS_PER_HOUR) {
      const slot = budget.next;
      const res = await send(email, `${process.env.VERCEL_PROJECT_PRODUCTION_URL || site.host}/alerts/${hour}/${slot}`, key, to);
      if (res?.status === 409) {
        // Another instance has used this slot, or is using it right now
        budget.next = Math.max(budget.next, slot + 1);
        continue;
      }
      if (!res?.ok) {
        // Refused or unreachable (said in the log): not counted as sent, and Resend gets a minute
        pausedUntil = Date.now() + PAUSE_MS;
        return hold();
      }
      budget.next = Math.max(budget.next, slot + 1);
      heldBack -= held;
      emailed.set(id, { at: now, since: sending.get(id) ?? 0 });
      if (emailed.size > 2000) {
        for (const [fp, entry] of emailed) if (now - entry.at >= REPEAT_EMAIL_MS) emailed.delete(fp);
      }
      return;
    }
    hold(); // This hour's alerts have all gone out
  } finally {
    sending.delete(id);
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const origin = req.headers.get('origin') || '';
  const site = new URL(req.url);
  const sameOrigin = origin !== '' && origin === site.origin;
  if (!ALLOWED_ORIGINS.has(origin) && !sameOrigin) return new Response(null, { status: 403 });
  const visitor = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  if (tooMany(visitor)) return new Response(null, { status: 429 });

  // Read no further than the cap (a character takes up to 3 bytes), then held to it in characters
  const raw = await readBody(req, MAX_BODY_CHARS * 3).catch(() => '');
  if (raw === null || raw.length > MAX_BODY_CHARS) return new Response(null, { status: 413 });
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const build = text(data?.build, 40);
  const report: AlertReport = {
    kind: data?.kind === 'rejection' ? 'rejection' : 'error',
    message: text(data?.message, 300).trim(),
    source: text(data?.source, 300),
    stack: text(data?.stack, 1500),
    page: text(data?.page, 200) || '/',
    build: BUILD.test(build) ? build : 'unknown',
    site: site.host,
    browser: text(req.headers.get('user-agent'), 200),
  };
  if (!report.message || (data?.kind !== 'error' && data?.kind !== 'rejection') || !PAGE.test(report.page)) {
    return new Response(null, { status: 400 });
  }

  const id = await fingerprint(report);
  console.error(`[live-error ${id}] ${JSON.stringify(report)}`);
  const key = process.env.RESEND_API_KEY;
  const to = process.env.REPORTS_EMAIL?.trim();
  if (key && to) {
    if (!EMAIL_ADDRESS.test(to)) console.error('[report] REPORTS_EMAIL is not an email address');
    else await toEmail(report, id, site, key, to);
  }
  return new Response(null, { status: 204 });
}
