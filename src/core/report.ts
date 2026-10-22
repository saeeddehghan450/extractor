/**
 * report.ts
 *
 * Renders a self-contained HTML report of a saved session: summary, findings, screenshots,
 * errors and network. One file (screenshots embedded, no JavaScript) that can be shared or printed.
 */

import fs from 'fs';
import path from 'path';

export type ReportLang = 'fa' | 'en';

const STRINGS: Record<ReportLang, Record<string, string>> = {
  en: {
    title: 'DevTools Extractor report',
    generated: 'Generated',
    started: 'Started',
    duration: 'Duration',
    device: 'Device',
    network: 'Network',
    collectors: 'Collectors',
    requests: 'Requests',
    failed: 'Failed',
    console: 'Console',
    errors: 'Errors',
    clicks: 'Clicks',
    snapshots: 'Snapshots',
    blocked: 'Blocked',
    page: 'Page',
    pageTitle: 'Title',
    elements: 'Elements',
    forms: 'Forms',
    links: 'Links',
    security: 'Security',
    secure: 'Secure context',
    issuer: 'Certificate issuer',
    missing: 'Missing security headers',
    mixed: 'Mixed content',
    cookieIssues: 'Cookies with weak flags',
    performance: 'Performance',
    heap: 'Heap used',
    a11y: 'Accessibility',
    a11yIssues: 'Elements without an accessible name',
    storage: 'Storage',
    cookies: 'Cookies',
    local: 'localStorage keys',
    screens: 'Snapshots',
    clickOn: 'Click on',
    consoleErrors: 'Errors in the console',
    problemRequests: 'Failed and error requests',
    allRequests: 'Requests',
    method: 'Method',
    status: 'Status',
    type: 'Type',
    size: 'Size',
    time: 'Time',
    url: 'URL',
    none: 'None',
    yes: 'Yes',
    no: 'No',
    more: 'and {n} more',
    reason_click: 'Click',
    reason_manual: 'Manual',
    reason_final: 'Final',
    'net_none': 'No throttling',
    'net_fast-4g': 'Fast 4G',
    'net_slow-4g': 'Slow 4G',
    'net_slow-3g': 'Slow 3G',
    net_offline: 'Offline'
  },
  fa: {
    title: 'گزارش DevTools Extractor',
    generated: 'تاریخ گزارش',
    started: 'شروع',
    duration: 'مدت',
    device: 'دستگاه',
    network: 'شبکه',
    collectors: 'کالکتورها',
    requests: 'درخواست‌ها',
    failed: 'ناموفق',
    console: 'کنسول',
    errors: 'خطاها',
    clicks: 'کلیک‌ها',
    snapshots: 'اسنپ‌شات‌ها',
    blocked: 'مسدودشده',
    page: 'صفحه',
    pageTitle: 'عنوان',
    elements: 'تعداد المان‌ها',
    forms: 'فرم‌ها',
    links: 'لینک‌ها',
    security: 'امنیت',
    secure: 'اتصال امن',
    issuer: 'صادرکننده گواهی',
    missing: 'هدرهای امنیتی ناموجود',
    mixed: 'محتوای مختلط',
    cookieIssues: 'کوکی‌های با تنظیم ناامن',
    performance: 'عملکرد',
    heap: 'Heap مصرفی',
    a11y: 'دسترس‌پذیری',
    a11yIssues: 'المان‌های بدون نام قابل دسترس',
    storage: 'ذخیره‌سازی',
    cookies: 'کوکی‌ها',
    local: 'کلیدهای localStorage',
    screens: 'اسنپ‌شات‌ها',
    clickOn: 'کلیک روی',
    consoleErrors: 'خطاهای کنسول',
    problemRequests: 'درخواست‌های ناموفق و خطادار',
    allRequests: 'درخواست‌ها',
    method: 'متد',
    status: 'وضعیت',
    type: 'نوع',
    size: 'حجم',
    time: 'زمان',
    url: 'آدرس',
    none: 'ندارد',
    yes: 'بله',
    no: 'خیر',
    more: 'و {n} مورد دیگر',
    reason_click: 'کلیک',
    reason_manual: 'دستی',
    reason_final: 'نهایی',
    'net_none': 'بدون محدودیت',
    'net_fast-4g': '4G سریع',
    'net_slow-4g': '4G کند',
    'net_slow-3g': '3G کند',
    net_offline: 'آفلاین'
  }
};

const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_ROWS = 500;

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const bytes = (n: number | null | undefined) => {
  if (n == null) return '—';
  const s = n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  return `<bdi>${s}</bdi>`;
};

const ms = (n: number | null | undefined) => (n == null ? '—' : `<bdi>${Math.round(n)} ms</bdi>`);

function duration(from?: string | null, to?: string | null): string {
  if (!from || !to) return '—';
  const s = Math.round((Date.parse(to) - Date.parse(from)) / 1000);
  return `<bdi>${s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}</bdi>`;
}

function embedImage(sessionDir: string, rel: string | null | undefined): string | null {
  if (!rel) return null;
  const file = path.resolve(sessionDir, rel);
  if (!file.startsWith(path.resolve(sessionDir) + path.sep) || !fs.existsSync(file)) return null;
  const size = fs.statSync(file).size;
  if (size > MAX_IMAGE_BYTES) return null;
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}

export function renderReport(analysis: any, summary: any, sessionDir: string, lang: ReportLang = 'en'): string {
  const L = STRINGS[lang] || STRINGS.en;
  const tr = (k: string, vars?: Record<string, string | number>) => {
    let s = L[k] ?? k;
    for (const [n, v] of Object.entries(vars || {})) s = s.replace(`{${n}}`, String(v));
    return s;
  };
  const a = analysis || {};
  const c = summary?.counts || a.meta?.counts || {};
  const emu = summary?.emulation || a.meta?.emulation;
  const kv = (rows: ([string, string] | null | false | undefined)[]) =>
    `<dl>${rows.filter((r): r is [string, string] => !!r).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const card = (title: string, body: string) => `<section class="card"><h3>${esc(title)}</h3>${body}</section>`;
  const yesNo = (b: unknown) => (b ? `<span class="ok">${esc(tr('yes'))}</span>` : `<span class="bad">${esc(tr('no'))}</span>`);

  // --- findings ---
  const cards: string[] = [];
  const ov = a.elements?.overview;
  if (ov) cards.push(card(tr('page'), kv([
    [tr('pageTitle'), esc(ov.title || '—')],
    [tr('elements'), esc(ov.elementCount)],
    [tr('forms'), esc(ov.forms?.length ?? 0)],
    [tr('links'), esc(ov.links)]
  ])));
  const sec = a.security;
  if (sec) cards.push(card(tr('security'), kv([
    [tr('secure'), yesNo(sec.isSecureContext)],
    sec.certificate ? [tr('issuer'), esc(sec.certificate.issuer || '—')] : null,
    [tr('mixed'), esc(sec.mixedContent?.length ?? 0)],
    [tr('cookieIssues'), esc(sec.cookieIssues?.length ?? 0)]
  ]) + `<p class="sub">${esc(tr('missing'))}</p><div class="chips">${(sec.missingHeaders || []).length
    ? sec.missingHeaders.map((h: string) => `<span class="chip warn">${esc(h)}</span>`).join('')
    : `<span class="ok">${esc(tr('none'))}</span>`}</div>`));
  const perf = a.performance;
  if (perf) {
    const nav = perf.timing?.navigation;
    cards.push(card(tr('performance'), kv([
      ['TTFB', ms(nav?.ttfb)],
      ['DOMContentLoaded', ms(nav?.domContentLoaded)],
      ['Load', ms(nav?.load)],
      ['FCP', ms(perf.timing?.paint?.['first-contentful-paint'])],
      ['LCP', ms(perf.timing?.largestContentfulPaint?.time)],
      ['CLS', esc(perf.timing?.cumulativeLayoutShift ?? '—')],
      perf.metrics ? [tr('heap'), bytes(perf.metrics.JSHeapUsedSize)] : null
    ])));
  }
  if (a.accessibility) cards.push(card(tr('a11y'), kv([[tr('a11yIssues'), esc(a.accessibility.issueCount ?? 0)]])));
  if (a.application) cards.push(card(tr('storage'), kv([
    [tr('cookies'), esc(a.application.cookies?.length ?? 0)],
    [tr('local'), esc(Object.keys(a.application.storageInfo?.localStorage || {}).length)]
  ])));

  // --- snapshots ---
  const snaps: any[] = summary?.snapshots || a.snapshots || [];
  let imageCount = 0;
  const gallery = snaps.map(s => {
    const img = imageCount < MAX_IMAGES ? embedImage(sessionDir, s.screenshot) : null;
    if (img) imageCount++;
    const caption = s.click
      ? `${esc(tr('clickOn'))} <code>&lt;${esc(String(s.click.tagName || '').toLowerCase())}&gt; ${esc(s.click.cssSelector || '')}</code>`
      : `<code>${esc(s.url)}</code>`;
    return `<figure>${img ? `<img src="${img}" alt="">` : '<div class="noimg"></div>'}
      <figcaption><strong>#${esc(s.seq)} · ${esc(tr('reason_' + s.reason))}</strong><br>${caption}</figcaption></figure>`;
  }).join('');

  // --- console errors ---
  const consoleErrors = [
    ...(a.console?.pageErrors || []).map((e: any) => ({ t: e.timestamp, text: e.message })),
    ...(a.console?.logs || []).filter((l: any) => l.type === 'error').map((l: any) => ({ t: l.timestamp, text: l.text }))
  ].sort((x, y) => String(x.t).localeCompare(String(y.t)));

  // --- network ---
  const reqs: any[] = a.network?.requests || [];
  const resps = new Map<string, any>((a.network?.responses || []).map((r: any) => [r.requestId, r]));
  const rowHtml = (r: any) => {
    const resp = resps.get(r.id);
    const status = r.failure ? `<span class="bad">${esc(r.failure)}</span>` : resp ? `<span class="${resp.status >= 400 ? 'bad' : 'ok'}">${esc(resp.status)}</span>` : '—';
    return `<tr><td><code>${esc(r.method)}</code></td><td>${status}</td><td>${esc(r.resourceType)}</td><td>${bytes(resp?.size)}</td><td>${ms(resp?.durationMs)}</td><td class="url">${esc(r.url)}</td></tr>`;
  };
  const tableHead = `<thead><tr><th>${esc(tr('method'))}</th><th>${esc(tr('status'))}</th><th>${esc(tr('type'))}</th><th>${esc(tr('size'))}</th><th>${esc(tr('time'))}</th><th>${esc(tr('url'))}</th></tr></thead>`;
  const problems = reqs.filter(r => r.failure || (resps.get(r.id)?.status ?? 0) >= 400);
  const more = (total: number) => (total > MAX_ROWS ? `<p class="sub">${esc(tr('more', { n: total - MAX_ROWS }))}</p>` : '');

  const stats = ([
    ['requests', c.requests], ['failed', c.failedRequests], ['blocked', c.blocked], ['console', c.console],
    ['errors', c.errors], ['clicks', c.clicks], ['snapshots', c.snapshots]
  ] as [string, number | undefined][]).filter(([, v]) => v !== undefined)
    .map(([k, v]) => `<div class="stat${(k === 'errors' || k === 'failed') && v ? ' bad' : ''}"><span>${esc(tr(k))}</span><b>${esc(v)}</b></div>`).join('');

  const title = ov?.title || summary?.url || a.meta?.targetUrl || '';

  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tr('title'))} · ${esc(title)}</title>
<style>
:root { --bg:#f5f7fb; --card:#fff; --text:#121826; --muted:#6b7280; --border:#e4e8f0; --ok:#059669; --bad:#dc2626; --warn:#b45309; --accent:#0891b2; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b0f17; --card:#131a27; --text:#e6ecf5; --muted:#8a94a6; --border:#243149; --ok:#34d399; --bad:#f87171; --warn:#fbbf24; --accent:#22d3ee; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.6 Vazirmatn, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 32px 20px 60px; }
header { border-bottom: 3px solid var(--accent); padding-bottom: 16px; margin-bottom: 24px; }
h1 { margin: 0 0 4px; font-size: 24px; } h2 { font-size: 18px; margin: 32px 0 12px; } h3 { margin: 0 0 10px; font-size: 15px; }
code, .url { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; direction: ltr; unicode-bidi: isolate; }
.meta { color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px 18px; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
.stat { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; }
.stat span { color: var(--muted); font-size: 12px; } .stat b { font-size: 22px; } .stat.bad b { color: var(--bad); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; break-inside: avoid; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; } dt { color: var(--muted); } dd { margin: 0; font-weight: 600; }
.sub { color: var(--muted); font-size: 12px; margin: 12px 0 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; } .chip { border: 1px solid var(--border); border-radius: 6px; padding: 1px 8px; font-size: 12px; }
.chip.warn { color: var(--warn); }
.ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
figure { margin: 0; background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; break-inside: avoid; }
figure img { width: 100%; display: block; border-bottom: 1px solid var(--border); }
.noimg { aspect-ratio: 16/10; background: var(--border); }
figcaption { padding: 8px 12px; font-size: 12.5px; word-break: break-all; }
table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; font-size: 12.5px; }
th, td { padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: start; vertical-align: top; }
th { color: var(--muted); font-weight: 600; } td.url { word-break: break-all; text-align: left; }
.errors li { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; color: var(--bad); direction: ltr; text-align: left; white-space: pre-wrap; word-break: break-word; margin-bottom: 4px; }
footer { margin-top: 40px; color: var(--muted); font-size: 12px; }
@media print { body { background: #fff; } .card, .stat, figure, table { border-color: #ccc; } }
</style>
</head>
<body>
<main>
  <header>
    <h1>${esc(title)}</h1>
    <div><code>${esc(summary?.url || a.meta?.targetUrl || '')}</code></div>
    <div class="meta">
      <span>${esc(tr('started'))}: <bdi>${esc(summary?.startedAt || a.meta?.startedAt || '')}</bdi></span>
      <span>${esc(tr('duration'))}: ${duration(summary?.startedAt, summary?.endedAt)}</span>
      ${emu ? `<span>${esc(tr('device'))}: ${esc(emu.deviceLabel)}</span><span>${esc(tr('network'))}: ${esc(L['net_' + emu.network] || emu.networkLabel)}</span>` : ''}
      <span>${esc(tr('collectors'))}: ${esc((summary?.collectors || a.meta?.collectors || []).length)}</span>
    </div>
  </header>

  <div class="stats">${stats}</div>

  ${cards.length ? `<div class="cards" style="margin-top:16px">${cards.join('')}</div>` : ''}

  ${snaps.length ? `<h2>${esc(tr('screens'))}</h2><div class="gallery">${gallery}</div>` : ''}

  ${consoleErrors.length ? `<h2>${esc(tr('consoleErrors'))} (${consoleErrors.length})</h2>
    <ul class="errors">${consoleErrors.slice(0, MAX_ROWS).map(e => `<li>${esc(e.text)}</li>`).join('')}</ul>${more(consoleErrors.length)}` : ''}

  ${problems.length ? `<h2>${esc(tr('problemRequests'))} (${problems.length})</h2>
    <table>${tableHead}<tbody>${problems.slice(0, MAX_ROWS).map(rowHtml).join('')}</tbody></table>${more(problems.length)}` : ''}

  ${reqs.length ? `<h2>${esc(tr('allRequests'))} (${reqs.length})</h2>
    <table>${tableHead}<tbody>${reqs.slice(0, MAX_ROWS).map(rowHtml).join('')}</tbody></table>${more(reqs.length)}` : ''}

  <footer>${esc(tr('title'))} · ${esc(tr('generated'))}: <bdi>${esc(new Date().toISOString())}</bdi> · <code>${esc(summary?.id || a.meta?.sessionId || '')}</code></footer>
</main>
</body>
</html>
`;
}
