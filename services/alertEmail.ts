// --- ALERT EMAILS ---
// The email api/report.ts sends when the site's own code fails in a visitor's browser. One restrained,
// monochrome layout for every alert; each kind of alert has its own status line (a small dot and a
// label) and its own opening sentence: an uncaught error (red dot), an unhandled promise rejection (amber
// dot), or an error still happening once its quiet hours are up (grey dot, with how often it was seen
// since). Built for phones first: mail apps take little CSS, so the layout is tables with inline styles,
// and two optional style blocks only tighten it on narrow screens and give dark-mode colours where the
// mail app supports them (one that drops them still shows the whole email). A plain-text copy goes with
// it. Everything in a report comes from a visitor's browser, so all of it is escaped, and the one link
// goes to the page on the site itself.

export interface AlertReport {
  kind: 'error' | 'rejection';
  message: string;
  source: string;
  stack: string;
  page: string;
  build: string;
  site: string;
  browser: string;
}

export interface AlertContext {
  id: string; // The fault's fingerprint
  at: number; // When this report came in (ms)
  origin: string; // The site's own origin, for the link to the page
  repeat?: { times: number; since: number }; // Seen `times` more times since the email sent at `since`
}

export interface AlertEmail {
  subject: string;
  html: string;
  text: string;
}

/** The same error is emailed again at most this often (per server instance). */
export const REPEAT_HOURS = 6;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Each kind's status line: the label and the colour of its dot (the only colour in the email)
const STATUS: Record<'error' | 'rejection' | 'repeat', { label: string; dot: string }> = {
  error: { label: 'Uncaught error', dot: '#dc2626' },
  rejection: { label: 'Unhandled promise rejection', dot: '#d97706' },
  repeat: { label: 'Still happening', dot: '#a1a1aa' },
};

const LEADS: Record<AlertReport['kind'], string> = {
  error: "A visitor's browser hit an error in the site's own code, and nothing caught it.",
  rejection: 'Something the site started in the background failed, and nothing handled the failure.',
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value: string) => value.replace(/[&<>"']/g, c => ESCAPES[c]);
// A code location that wraps after a / or : on a phone rather than mid-name
const breakable = (value: string) => esc(value).replace(/([/:])/g, '$1<wbr>');
const font = (weight: number, size: number, line: number, family = FONT) =>
  `font-family:${family}; font-size:${size}px; line-height:${line}px; font-weight:${weight};`;
const WRAP = 'word-break:break-word; overflow-wrap:anywhere;';

/** "9 Oct 2026, 16:02 UTC" */
export function when(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** "Chrome 141 on Windows" from a user agent; browsers built on Chrome are checked before it. */
export function browserName(ua: string): string {
  const version = (pattern: RegExp) => ua.match(pattern)?.[1];
  const named: [string, RegExp][] = [
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//],
  ];
  const found = named.find(([, pattern]) => version(pattern));
  const os = /iPad/.test(ua) ? 'iPad' : /iPhone|iPod/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  if (!found) return os ? `A browser on ${os}` : 'Unknown browser';
  const name = `${found[0]} ${version(found[1])}`;
  return os ? `${name} on ${os}` : name;
}

/** A link to the page the error happened on, and only ever to a page on the site itself. */
export function pageLink(origin: string, page: string): string | null {
  if (!/^\/(?![/\\])/.test(page)) return null;
  try {
    const base = new URL(origin);
    const url = new URL(page, base);
    return url.origin === base.origin ? url.href : null;
  } catch {
    return null;
  }
}

const isApp = (page: string) => /^\/app(\/|$)/.test(page);
const pageName = (page: string) => (page === '/' ? 'Landing page' : isApp(page) ? 'App' : page);
const buttonText = (page: string) => (page === '/' ? 'Open the landing page' : isApp(page) ? 'Open the app' : 'Open the page');

/** The stack's lines as function and location (Chrome "at fn (where)", Firefox and Safari "fn@where"). */
function frames(stack: string): { fn: string; at: string }[] {
  return stack.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8).map(line => {
    const chrome = line.match(/^at (.+?) \((.+)\)$/);
    if (chrome) return { fn: chrome[1], at: chrome[2] };
    if (line.startsWith('at ')) return { fn: '', at: line.slice(3) };
    const other = line.match(/^(.*)@(.+)$/);
    return other ? { fn: other[1], at: other[2] } : { fn: '', at: line };
  });
}

export function alertEmail(report: AlertReport, context: AlertContext): AlertEmail {
  const { id, at, origin, repeat } = context;
  const status = repeat ? STATUS.repeat : STATUS[report.kind];
  const statusLabel = repeat ? `${STATUS.repeat.label} · ${STATUS[report.kind].label}` : status.label;
  const where = `${report.site}${report.page}`;
  const browser = browserName(report.browser);
  const link = pageLink(origin, report.page);
  const lead = repeat
    ? `Seen ${repeat.times} more ${repeat.times === 1 ? 'time' : 'times'} on this server since the last email about it (${when(repeat.since)}).`
    : LEADS[report.kind];
  const list = frames(report.stack);
  const subject = `Live error: ${report.message.replace(/\s+/g, ' ').slice(0, 90)} [${id}]`;
  const footer = `Fingerprint ${id}, in the server log as [live-error ${id}]. This error is emailed again at most every ${REPEAT_HOURS} hours.`;

  const text = [
    `${statusLabel} on ${where}`,
    lead,
    '',
    report.message,
    '',
    `When: ${when(at)}`,
    `Build: ${report.build}`,
    `Browser: ${browser}`,
    '',
    'Where in the code:',
    ...(report.stack ? report.stack.split('\n') : [report.source || 'No location was reported.']),
    ...(link ? ['', `${buttonText(report.page)}: ${link}`] : []),
    '',
    footer,
    ...(report.browser ? [`Full browser: ${report.browser}`] : []),
  ].join('\n');

  const label = (name: string) =>
    `<p class="muted" style="margin:0; ${font(600, 11, 16)} letter-spacing:0.06em; text-transform:uppercase; color:#71717a;">${name}</p>`;
  const detail = (name: string, value: string, sub = '') =>
    label(name) +
    `<p class="strong" style="margin:3px 0 0; ${font(500, 14, 20)} color:#18181b; ${WRAP}">${esc(value)}</p>` +
    (sub ? `<p class="muted" style="margin:1px 0 0; ${font(400, 12, 17)} color:#71717a; ${WRAP}">${breakable(sub)}</p>` : '');
  const cell = (content: string, left: boolean) =>
    `<td class="stack" width="50%" valign="top" style="padding:14px ${left ? '12px' : '0'} 0 0;">${content}</td>`;
  // Each frame: the function on a line of its own, where it is underneath
  const code = list.length
    ? list.map((f, i) => `<div style="${i ? 'margin-top:8px;' : ''}">${f.fn ? `<span class="strong" style="color:#18181b; font-weight:600;">${esc(f.fn)}</span><br>` : ''}<span class="muted" style="color:#71717a;">${breakable(f.at)}</span></div>`).join('')
    : breakable(report.source || 'No location was reported.');
  const preheader = `${statusLabel} on ${where} · ${browser} · build ${report.build}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<style>
@media only screen and (max-width: 620px) {
  .wrap { padding: 16px 10px 24px !important; }
  .pad { padding: 22px 18px 22px !important; }
  .stack { display: block !important; width: 100% !important; padding-right: 0 !important; }
  .headline { font-size: 18px !important; line-height: 25px !important; }
  .btn { width: 100% !important; }
  .btn a { display: block !important; text-align: center !important; }
}
</style>
<style>
@media (prefers-color-scheme: dark) {
  .page { background: #09090b !important; }
  .card { background: #18181b !important; border-color: #27272a !important; }
  .strong { color: #fafafa !important; }
  .body { color: #d4d4d8 !important; }
  .muted { color: #a1a1aa !important; }
  .rule { border-color: #27272a !important; }
  .code { background: #111113 !important; border-color: #27272a !important; }
  .btn a { background: #fafafa !important; color: #18181b !important; }
}
</style>
</head>
<body class="page" style="margin:0; padding:0; background:#f4f4f5; -webkit-text-size-adjust:100%;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${esc(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background:#f4f4f5;">
<tr><td align="center" class="wrap" style="padding:28px 16px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 4px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="strong" style="${font(650, 16, 20)} color:#18181b; letter-spacing:-0.01em;">Argus</td>
<td align="right" class="muted" style="${font(500, 12, 20)} color:#71717a;">Error alert</td>
</tr></table>
</td></tr>
<tr><td class="card" style="background:#ffffff; border:1px solid #e4e4e7; border-radius:12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pad" style="padding:26px 28px 26px;">
<p class="body" style="margin:0; ${font(600, 13, 18)} color:#3f3f46;"><span style="color:${status.dot}; font-size:12px;">&#9679;</span>&nbsp; ${esc(statusLabel)}</p>
<h1 class="strong headline" style="margin:10px 0 8px; ${font(600, 20, 27)} color:#18181b; ${WRAP}">${esc(report.message)}</h1>
<p class="body" style="margin:0; ${font(400, 14, 21)} color:#52525b;">${esc(lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="rule" style="margin-top:20px; border-top:1px solid #e4e4e7;">
<tr>${cell(detail('Page', pageName(report.page), where), true)}${cell(detail('When', when(at)), false)}</tr>
<tr>${cell(detail('Browser', browser), true)}${cell(detail('Build', report.build), false)}</tr>
</table>
${link ? `<table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td><a href="${esc(link)}" style="display:inline-block; background:#18181b; color:#fafafa; ${font(600, 14, 20)} text-decoration:none; padding:12px 18px; border-radius:8px;">${buttonText(report.page)}</a></td></tr></table>` : ''}
<div style="margin:26px 0 8px;">${label('Where in the code')}</div>
<div class="code" style="background:#fafafa; border:1px solid #e4e4e7; border-radius:8px; padding:12px 14px; ${font(400, 12.5, 19, MONO)} color:#3f3f46; ${WRAP}">${code}</div>
</td></tr></table>
</td></tr>
<tr><td class="muted" style="padding:16px 6px 0; ${font(400, 12, 18)} color:#71717a;">${esc(footer)}${report.browser ? `<br>Full browser: <span style="${WRAP}">${esc(report.browser)}</span>` : ''}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
