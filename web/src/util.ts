import { icon, hydrateIcons } from './icons.js';
import { t, fmtNumber } from './i18n.js';
import type { SessionStatus } from './types.js';

/** querySelector that assumes the element exists (all selectors target our own markup). */
export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  return root.querySelector<T>(sel) as T;
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  // wrapped in a left-to-right isolate so "9.6 KB" never turns into "KB 9.6" in RTL
  const text = n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `⁦${text}⁩`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return t('common.ms', { n: fmtNumber(Math.round(ms)) });
  if (ms < 60000) return t('common.sec', { n: fmtNumber(Math.round(ms / 100) / 10) });
  return t('common.min', { n: fmtNumber(Math.round(ms / 6000) / 10) });
}

export function statusClass(code: number | null | undefined): string {
  if (!code) return 'sx';
  return `s${String(code)[0]}`;
}

export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url || ''; }
}

const STATUS_CLASSES: Record<SessionStatus, string> = {
  running: 'ok live', starting: 'info live', stopping: 'warn live', finished: 'accent', error: 'err'
};

export function statusPill(status: SessionStatus): string {
  return `<span class="pill ${STATUS_CLASSES[status] || ''}"><span class="dot"></span>${esc(t('status.' + status))}</span>`;
}

export function html<T extends HTMLElement>(el: T, markup: string): T {
  el.innerHTML = markup;
  hydrateIcons(el);
  return el;
}

// ---------- toasts ----------
export type ToastKind = 'ok' | 'err' | 'info';

export function toast(message: string, kind: ToastKind = 'info', timeout = 3500): void {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const ico = kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'zap';
  el.innerHTML = `${icon(ico)}<div>${esc(message)}</div>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, timeout);
  setTimeout(() => el.remove(), timeout + 350);
}

/** Message of an unknown thrown value. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------- drawer ----------
export function openDrawer(title: string, bodyHtml: string): HTMLElement {
  $('#drawerTitle').textContent = title;
  const body = $('#drawerBody');
  html(body, bodyHtml);
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawerBackdrop').classList.add('open');
  return body;
}

export function closeDrawer(): void {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawerBackdrop').classList.remove('open');
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('common.copied'), 'ok', 1500);
  } catch {
    toast(t('common.error'), 'err');
  }
}

export function headersTable(headers: Record<string, string> | null | undefined): string {
  const entries = Object.entries(headers || {});
  if (!entries.length) return `<div class="muted small">${esc(t('common.noData'))}</div>`;
  return `<div class="table-wrap" style="max-height:320px"><table class="table"><tbody>${entries
    .map(([k, v]) => `<tr><td class="mono" style="white-space:nowrap;color:var(--accent-2)">${esc(k)}</td><td class="mono ltr" style="word-break:break-all">${esc(v)}</td></tr>`)
    .join('')}</tbody></table></div>`;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 200): (...args: A) => void {
  let id: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

/** Value of the input that fired an event. */
export function inputValue(e: Event): string {
  return (e.target as HTMLInputElement).value;
}
