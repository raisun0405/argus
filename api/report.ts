// Vercel Edge Function: error reports from visitors' browsers (services/errorReporter.ts).
//
// Each report is written to the server log. When RESEND_API_KEY (a Resend API key with "Sending
// access") and REPORTS_EMAIL (where alerts go) are set, a new kind of error is also emailed; the same
// error again at most every 6 hours per server instance, under the same subject, so a mail client
// keeps them in one thread. A report holds the error, where in the code, the page's path and the
// build, and nothing else from the page.

export const config = { runtime: 'edge' };

// Same origins as /api/analyze: other websites can't file reports from their pages
const ALLOWED_ORIGINS = new Set<string>([
  // The deployed address goes here too (requests from the page's own address always pass)
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const MAX_BODY_CHARS = 4000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REPORTS = 10; // Per visitor per minute; a page sends at most five
const EMAIL_TIMEOUT_MS = 5000;
const REPEAT_EMAIL_MS = 6 * 60 * 60_000; // The same error again: one email every 6 hours at most
const MAX_EMAILS_PER_HOUR = 10; // Per server instance, whatever arrives
// Resend's shared sender: without a domain of your own there, it delivers only to the address you signed up with
const SENDER = 'Argus alerts <onboarding@resend.dev>';
const EMAIL_ADDRESS = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;

const recentReports = new Map<string, number[]>();
const lastEmailed = new Map<string, number>(); // Fingerprint -> when it was last emailed
let emailsSent: number[] = [];

interface ErrorReport {
  kind: 'error' | 'rejection';
  message: string;
  source: string;
  stack: string;
  page: string;
  build: string;
  site: string;
  browser: string;
}

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
async function fingerprint(report: ErrorReport): Promise<string> {
  const where = report.stack.split('\n')[0]?.replace(/\(.*$|@.*$|:\d+:\d+.*$/, '').trim() || report.source.replace(/:\d+(:\d+)?$/, '');
  const data = new TextEncoder().encode(`${report.message.replace(/\d+/g, '#')}|${where}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Emails a report through Resend: each kind of error once, then at most every 6 hours (throttled per instance). */
async function toEmail(report: ErrorReport, id: string, key: string, to: string): Promise<void> {
  const now = Date.now();
  emailsSent = emailsSent.filter(t => now - t < 60 * 60_000);
  if (emailsSent.length >= MAX_EMAILS_PER_HOUR) return;
  if (now - (lastEmailed.get(id) ?? 0) < REPEAT_EMAIL_MS) return;
  lastEmailed.set(id, now);
  emailsSent.push(now);
  const lines = [
    `${report.kind === 'rejection' ? 'Unhandled promise rejection' : 'Uncaught error'} on ${report.site}${report.page}`,
    `When: ${new Date(now).toISOString()}`,
    `Build: ${report.build}`,
    `Browser: ${report.browser || 'unknown'}`,
    '',
    report.message,
  ];
  if (report.source) lines.push('', `Source: ${report.source}`);
  if (report.stack) lines.push('', "Stack (the app's own code):", report.stack);
  lines.push('', `Every report is also in the server log under [live-error ${id}]. This error is emailed again at most every 6 hours.`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'argus-error-reports' },
      body: JSON.stringify({
        from: SENDER,
        to,
        // The same subject for the same fault, so its emails stay in one thread
        subject: `Live error: ${report.message.replace(/\s+/g, ' ').slice(0, 90)} [${id}]`,
        text: lines.join('\n'),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const reason = await res.json().then((body: any) => (typeof body?.message === 'string' ? `: ${body.message.slice(0, 200)}` : ''), () => '');
      console.error(`[report] Resend ${res.status}${reason}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const origin = req.headers.get('origin') || '';
  const sameOrigin = origin !== '' && origin === new URL(req.url).origin;
  if (!ALLOWED_ORIGINS.has(origin) && !sameOrigin) return new Response(null, { status: 403 });
  const visitor = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  if (tooMany(visitor)) return new Response(null, { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return new Response(null, { status: 413 });
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const report: ErrorReport = {
    kind: data?.kind === 'rejection' ? 'rejection' : 'error',
    message: text(data?.message, 300).trim(),
    source: text(data?.source, 300),
    stack: text(data?.stack, 1500),
    page: text(data?.page, 200) || '/',
    build: text(data?.build, 40) || 'unknown',
    site: new URL(req.url).host,
    browser: text(req.headers.get('user-agent'), 200),
  };
  if (!report.message || (data?.kind !== 'error' && data?.kind !== 'rejection')) return new Response(null, { status: 400 });

  const id = await fingerprint(report);
  console.error(`[live-error ${id}] ${JSON.stringify(report)}`);
  const key = process.env.RESEND_API_KEY;
  const to = process.env.REPORTS_EMAIL?.trim();
  if (key && to) {
    if (!EMAIL_ADDRESS.test(to)) {
      console.error('[report] REPORTS_EMAIL is not an email address');
    } else {
      try {
        await toEmail(report, id, key, to);
      } catch {
        // Resend unreachable or slow: the log line above still has it
      }
    }
  }
  return new Response(null, { status: 204 });
}
