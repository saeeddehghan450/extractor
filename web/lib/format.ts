import { t, fmtNumber } from './i18n';

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

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Save text as a file. */
export function download(name: string, content: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
