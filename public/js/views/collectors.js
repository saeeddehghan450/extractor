import { api } from '../api.js';
import { icon, COLLECTOR_ICONS } from '../icons.js';
import { t, fmtNumber } from '../i18n.js';
import { state } from '../store.js';
import { $, esc, html, toast } from '../util.js';

export function mount(el, _params, { setHeader }) {
  setHeader(t('collectors.title'), t('collectors.subtitle'));

  const render = () => {
    const cfg = state.config;
    const meta = state.meta;
    if (!cfg || !meta) {
      html(el, `<div class="empty">${esc(t('common.loading'))}</div>`);
      return;
    }
    const enabledCount = meta.collectors.filter(c => cfg.collectors[c.name]?.enabled).length;
    const activePreset = meta.presets.find(p => meta.collectors.every(c => !!p.collectors[c.name] === !!cfg.collectors[c.name]?.enabled));

    html(el, `
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <h3>${esc(t('collectors.presets'))}</h3>
            <span class="muted small">${esc(t('collectors.presets.hint'))}</span>
          </div>
          <div class="presets">
            ${meta.presets.map(p => `
              <button class="preset ${activePreset?.key === p.key ? 'active' : ''}" data-preset="${esc(p.key)}">
                <strong>${esc(t('preset.' + p.key))}</strong>
                <span>${esc(t('preset.' + p.key + '.d'))}</span>
                <span class="small" style="margin-top:6px">${fmtNumber(Object.values(p.collectors).filter(Boolean).length)} / ${fmtNumber(meta.collectors.length)}</span>
              </button>`).join('')}
          </div>
        </div>

        <div class="row">
          <span class="pill accent">${esc(t('collectors.enabledCount', { n: fmtNumber(enabledCount), total: fmtNumber(meta.collectors.length) }))}</span>
          <span class="spacer"></span>
          <button class="btn sm" id="allOn">${icon('check')}${esc(t('collectors.enableAll'))}</button>
          <button class="btn sm ghost" id="allOff">${icon('x')}${esc(t('collectors.disableAll'))}</button>
        </div>

        <div class="collector-grid">
          ${meta.collectors.map(c => {
            const on = !!cfg.collectors[c.name]?.enabled;
            return `
              <label class="collector ${on ? 'on' : 'off'}">
                <div class="ico">${icon(COLLECTOR_ICONS[c.name])}</div>
                <div class="body">
                  <h4>${esc(t('col.' + c.name))}
                    <span class="pill ${c.kind === 'stream' ? 'info' : ''}">${esc(t('collectors.kind.' + c.kind))}</span>
                    ${c.heavy ? `<span class="pill warn">${esc(t('collectors.heavy'))}</span>` : ''}
                  </h4>
                  <p>${esc(t('col.' + c.name + '.d'))}</p>
                  <code>${esc(c.name)}</code>
                </div>
                <span class="switch"><input type="checkbox" data-collector="${esc(c.name)}" ${on ? 'checked' : ''}><span></span></span>
              </label>`;
          }).join('')}
        </div>
      </div>
    `);
  };

  const save = async patch => {
    try {
      state.config = await api.saveConfig(patch);
      render();
      toast(t('collectors.saved'), 'ok', 1500);
    } catch (e) {
      toast(e.message, 'err');
      render();
    }
  };

  el.addEventListener('change', e => {
    const input = e.target.closest('input[data-collector]');
    if (input) save({ collectors: { [input.dataset.collector]: input.checked } });
  });

  el.addEventListener('click', async e => {
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      try {
        state.config = await api.applyPreset(preset.dataset.preset);
        render();
        toast(t('collectors.applied', { name: t('preset.' + preset.dataset.preset) }), 'ok');
      } catch (err) { toast(err.message, 'err'); }
      return;
    }
    if (e.target.closest('#allOn') || e.target.closest('#allOff')) {
      const value = !!e.target.closest('#allOn');
      save({ collectors: Object.fromEntries(state.meta.collectors.map(c => [c.name, value])) });
    }
  });

  render();
}
