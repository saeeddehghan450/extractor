'use client';

import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/format';
import { t } from '@/lib/i18n';
import { setConfig, state } from '@/lib/store';
import { toast, useHeader } from '@/lib/ui';

export function SettingsView() {
  useHeader(t('settings.title'), t('settings.subtitle'));
  const cfg = state.config;
  const forced = !!state.meta?.forceHeadless;
  const [form, setForm] = useState({
    targetUrl: cfg?.targetUrl || '',
    headless: !!cfg?.headless || forced,
    vpW: String(cfg?.viewport?.width ?? 1280),
    vpH: String(cfg?.viewport?.height ?? 800),
    slowMo: String(cfg?.slowMo ?? 0),
    trace: String(cfg?.performanceTraceMs ?? 3000),
    exe: cfg?.executablePath || ''
  });
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setConfig(await api.saveConfig({
        targetUrl: form.targetUrl,
        headless: forced ? undefined : form.headless,
        slowMo: Number(form.slowMo) || 0,
        performanceTraceMs: Number(form.trace) || 0,
        viewport: { width: Number(form.vpW), height: Number(form.vpH) },
        executablePath: form.exe
      }));
      toast(t('settings.saved'), 'ok');
    } catch (err) {
      toast(errMsg(err), 'err');
    }
  };

  return (
    <form className="card stack" id="settingsForm" style={{ maxWidth: 760 }} onSubmit={submit}>
      <div className="card-head"><h3><Icon name="globe" /> {t('settings.browser')}</h3></div>

      <div className="field">
        <label htmlFor="targetUrl">{t('settings.targetUrl')}</label>
        <input className="input ltr" id="targetUrl" value={form.targetUrl} onChange={e => set('targetUrl')(e.target.value)} spellCheck={false} />
      </div>

      <label className="row" style={{ cursor: 'pointer' }}>
        <Switch id="headless" checked={form.headless} disabled={forced} onChange={set('headless')} />
        <span><strong>{t('settings.headless')}</strong><br /><span className="muted small">{t('settings.headless.hint')}</span></span>
      </label>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        <div className="field">
          <label>{t('settings.viewport')}</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input ltr" id="vpW" type="number" min={320} value={form.vpW} onChange={e => set('vpW')(e.target.value)} />
            <span className="muted">×</span>
            <input className="input ltr" id="vpH" type="number" min={240} value={form.vpH} onChange={e => set('vpH')(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="slowMo">{t('settings.slowMo')}</label>
          <input className="input ltr" id="slowMo" type="number" min={0} value={form.slowMo} onChange={e => set('slowMo')(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="trace">{t('settings.trace')}</label>
          <input className="input ltr" id="trace" type="number" min={0} step={500} value={form.trace} onChange={e => set('trace')(e.target.value)} />
          <span className="hint">{t('settings.trace.hint')}</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="exe">{t('settings.executable')}</label>
        <input className="input ltr" id="exe" value={form.exe} onChange={e => set('exe')(e.target.value)} placeholder="/usr/bin/chromium" spellCheck={false} />
        <span className="hint">{t('settings.executable.hint')}</span>
      </div>

      <div className="field">
        <label>{t('settings.output')}</label>
        <code className="ltr muted">{state.meta?.outputDir || 'output/'}</code>
      </div>

      <div className="row"><button className="btn primary" type="submit"><Icon name="check" />{t('settings.save')}</button></div>
    </form>
  );
}
