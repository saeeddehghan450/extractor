import { api } from '../api.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { state } from '../store.js';
import { $, errMsg, esc, html, toast } from '../util.js';
import type { ViewContext } from '../types.js';

export function mount(el: HTMLElement, _params: string[], { setHeader }: ViewContext): void {
  setHeader(t('settings.title'), t('settings.subtitle'));
  const cfg: Partial<NonNullable<typeof state.config>> = state.config || {};
  const vp = cfg.viewport || { width: 1280, height: 800 };

  html(el, `
    <form class="card stack" id="settingsForm" style="max-width:760px">
      <div class="card-head"><h3>${icon('globe')} ${esc(t('settings.browser'))}</h3></div>

      <div class="field">
        <label for="targetUrl">${esc(t('settings.targetUrl'))}</label>
        <input class="input ltr" id="targetUrl" value="${esc(cfg.targetUrl || '')}" spellcheck="false">
      </div>

      <label class="row" style="cursor:pointer">
        <span class="switch"><input type="checkbox" id="headless" ${cfg.headless || state.meta?.forceHeadless ? 'checked' : ''} ${state.meta?.forceHeadless ? 'disabled' : ''}><span></span></span>
        <span><strong>${esc(t('settings.headless'))}</strong><br><span class="muted small">${esc(t('settings.headless.hint'))}</span></span>
      </label>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        <div class="field">
          <label>${esc(t('settings.viewport'))}</label>
          <div class="row" style="flex-wrap:nowrap">
            <input class="input ltr" id="vpW" type="number" min="320" value="${esc(vp.width)}">
            <span class="muted">×</span>
            <input class="input ltr" id="vpH" type="number" min="240" value="${esc(vp.height)}">
          </div>
        </div>
        <div class="field">
          <label for="slowMo">${esc(t('settings.slowMo'))}</label>
          <input class="input ltr" id="slowMo" type="number" min="0" value="${esc(cfg.slowMo ?? 0)}">
        </div>
        <div class="field">
          <label for="trace">${esc(t('settings.trace'))}</label>
          <input class="input ltr" id="trace" type="number" min="0" step="500" value="${esc(cfg.performanceTraceMs ?? 3000)}">
          <span class="hint">${esc(t('settings.trace.hint'))}</span>
        </div>
      </div>

      <div class="field">
        <label for="exe">${esc(t('settings.executable'))}</label>
        <input class="input ltr" id="exe" value="${esc(cfg.executablePath || '')}" placeholder="/usr/bin/chromium" spellcheck="false">
        <span class="hint">${esc(t('settings.executable.hint'))}</span>
      </div>

      <div class="field">
        <label>${esc(t('settings.output'))}</label>
        <code class="ltr muted">${esc(state.meta?.outputDir || 'output/')}</code>
      </div>

      <div class="row"><button class="btn primary" type="submit">${icon('check')}${esc(t('settings.save'))}</button></div>
    </form>
  `);

  const input = (sel: string) => $<HTMLInputElement>(sel, el);
  $<HTMLFormElement>('#settingsForm', el).onsubmit = async e => {
    e.preventDefault();
    try {
      state.config = await api.saveConfig({
        targetUrl: input('#targetUrl').value,
        headless: state.meta?.forceHeadless ? undefined : input('#headless').checked,
        slowMo: Number(input('#slowMo').value) || 0,
        performanceTraceMs: Number(input('#trace').value) || 0,
        viewport: { width: Number(input('#vpW').value), height: Number(input('#vpH').value) },
        executablePath: input('#exe').value
      });
      toast(t('settings.saved'), 'ok');
    } catch (err) {
      toast(errMsg(err), 'err');
    }
  };
}
