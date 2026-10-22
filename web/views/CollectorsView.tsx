'use client';

import { COLLECTOR_ICONS, Icon } from '@/components/Icon';
import { Empty, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/format';
import { fmtNumber, t } from '@/lib/i18n';
import { setConfig, state, useStoreVersion } from '@/lib/store';
import type { ConfigPatch } from '@/lib/types';
import { toast, useHeader } from '@/lib/ui';

export function CollectorsView() {
  useHeader(t('collectors.title'), t('collectors.subtitle'));
  useStoreVersion(['local']);
  const cfg = state.config;
  const meta = state.meta;
  if (!cfg || !meta) return <Empty>{t('common.loading')}</Empty>;

  const enabledCount = meta.collectors.filter(c => cfg.collectors[c.name]?.enabled).length;
  const activePreset = meta.presets.find(p => meta.collectors.every(c => !!p.collectors[c.name] === !!cfg.collectors[c.name]?.enabled));

  const save = async (patch: ConfigPatch) => {
    try {
      setConfig(await api.saveConfig(patch));
      toast(t('collectors.saved'), 'ok', 1500);
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const applyPreset = async (key: string) => {
    try {
      setConfig(await api.applyPreset(key));
      toast(t('collectors.applied', { name: t('preset.' + key) }), 'ok');
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const setAll = (value: boolean) => save({ collectors: Object.fromEntries(meta.collectors.map(c => [c.name, value])) });

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h3>{t('collectors.presets')}</h3>
          <span className="muted small">{t('collectors.presets.hint')}</span>
        </div>
        <div className="presets">
          {meta.presets.map(p => (
            <button key={p.key} className={`preset ${activePreset?.key === p.key ? 'active' : ''}`} data-preset={p.key} onClick={() => applyPreset(p.key)}>
              <strong>{t('preset.' + p.key)}</strong>
              <span>{t('preset.' + p.key + '.d')}</span>
              <span className="small" style={{ marginTop: 6 }}>{fmtNumber(Object.values(p.collectors).filter(Boolean).length)} / {fmtNumber(meta.collectors.length)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <span className="pill accent">{t('collectors.enabledCount', { n: fmtNumber(enabledCount), total: fmtNumber(meta.collectors.length) })}</span>
        <span className="spacer" />
        <button className="btn sm" id="allOn" onClick={() => setAll(true)}><Icon name="check" />{t('collectors.enableAll')}</button>
        <button className="btn sm ghost" id="allOff" onClick={() => setAll(false)}><Icon name="x" />{t('collectors.disableAll')}</button>
      </div>

      <div className="collector-grid">
        {meta.collectors.map(c => {
          const on = !!cfg.collectors[c.name]?.enabled;
          return (
            <label key={c.name} className={`collector ${on ? 'on' : 'off'}`}>
              <div className="ico"><Icon name={COLLECTOR_ICONS[c.name]} /></div>
              <div className="body">
                <h4>
                  {t('col.' + c.name)}{' '}
                  <span className={`pill ${c.kind === 'stream' ? 'info' : ''}`}>{t('collectors.kind.' + c.kind)}</span>
                  {c.heavy && <> <span className="pill warn">{t('collectors.heavy')}</span></>}
                </h4>
                <p>{t('col.' + c.name + '.d')}</p>
                <code>{c.name}</code>
              </div>
              <Switch checked={on} onChange={v => save({ collectors: { [c.name]: v } })} />
            </label>
          );
        })}
      </div>
    </div>
  );
}
