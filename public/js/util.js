import { icon, hydrateIcons } from './icons.js';
import { t, fmtNumber } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '—';
  // wrapped in a left-to-right isolate so "9.6 KB" never turns into "KB 9.6" in RTL
  const text = n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `\u2066${text}\u2069`;
}

export function fmtDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return t('common.ms', { n: fmtNumber(Math.round(ms)) });
  if (ms < 60000) return t('common.sec', { n: fmtNumber(Math.round(ms / 100) / 10) });
  return t('common.min', { n: fmtNumber(Math.round(ms / 6000) / 10) });
}

export function statusClass(code) {
  if (!code) return 'sx';
  return `s${String(code)[0]}`;
}

export function hostOf(url) {
  try { return new URL(url).host; } catch { return url || ''; }
}

export function statusPill(status) {
  const map = { running: 'ok live', starting: 'info live', stopping: 'warn live', finished: 'accent', error: 'err' };
  return `<span class="pill ${map[status] || ''}"><span class="dot"></span>${esc(t('status.' + status))}</span>`;
}

export function html(el, markup) {
  el.innerHTML = markup;
  hydrateIcons(el);
  return el;
}

// ---------- toasts ----------
export function toast(message, kind = 'info', timeout = 3500) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const ico = kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'zap';
  el.innerHTML = `${icon(ico)}<div>${esc(message)}</div>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, timeout);
  setTimeout(() => el.remove(), timeout + 350);
}

// ---------- drawer ----------
export function openDrawer(title, bodyHtml) {
  $('#drawerTitle').textContent = title;
  const body = $('#drawerBody');
  html(body, bodyHtml);
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawerBackdrop').classList.add('open');
  return body;
}

export function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawerBackdrop').classList.remove('open');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('common.copied'), 'ok', 1500);
  } catch {
    toast(t('common.error'), 'err');
  }
}

export function headersTable(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return `<div class="muted small">${esc(t('common.noData'))}</div>`;
  return `<div class="table-wrap" style="max-height:320px"><table class="table"><tbody>${entries
    .map(([k, v]) => `<tr><td class="mono" style="white-space:nowrap;color:var(--accent-2)">${esc(k)}</td><td class="mono ltr" style="word-break:break-all">${esc(v)}</td></tr>`)
    .join('')}</tbody></table></div>`;
}

export function debounce(fn, ms = 200) {
  let id;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}
