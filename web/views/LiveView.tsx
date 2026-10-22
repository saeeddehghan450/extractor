'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ConsoleLines, openJsonFile, openLiveRequest, openScreenshot } from '@/components/Details';
import { COLLECTOR_ICONS, Icon } from '@/components/Icon';
import { LiveCanvas } from '@/components/LiveCanvas';
import { Empty, EmulationPills, Seg, Spinner, Stat, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, fmtBytes, fmtDuration, statusClass } from '@/lib/format';
import { fmtNumber, fmtTime, t } from '@/lib/i18n';
import type { LiveView as LiveViewClass } from '@/lib/liveView';
import { setConfig, setSession, state, useStoreVersion } from '@/lib/store';
import type { EmulationOptions, NetworkRow, SessionSummary } from '@/lib/types';
import { toast, useHeader } from '@/lib/ui';

const NET_TYPES: [string, string][] = [
  ['all', 'net.all'], ['document', 'Doc'], ['xhr', 'Fetch/XHR'], ['script', 'JS'], ['stylesheet', 'CSS'], ['image', 'Img'], ['font', 'Font'], ['other', 'Other']
];

const isActive = (s: SessionSummary | null): boolean => !!s && (s.status === 'running' || s.status === 'starting' || s.status === 'stopping');

export function LiveSessionView() {
  useHeader(t('live.title'), t('live.subtitle'));
  useStoreVersion(['status', 'hello']);
  const s = state.session;
  const active = isActive(s);
  // the session that finished while this page was open (or the last one)
  const [finished, setFinished] = useState<SessionSummary | null>(s && s.status === 'finished' ? s : null);
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active && s?.status === 'finished') setFinished(s);
    wasActive.current = active;
  }, [active, s]);

  return active ? <RunningSession key={s!.id} /> : <StartScreen finished={finished} />;
}

// ---------------------------------------------------------------------------
// start screen
// ---------------------------------------------------------------------------

function StartScreen({ finished }: { finished: SessionSummary | null }) {
  const cfg = state.config;
  const meta = state.meta;
  const emu: EmulationOptions = cfg?.emulation || { device: 'desktop', network: 'none' };
  const forced = !!meta?.forceHeadless;
  const collectors = meta?.collectors || [];
  const enabled = collectors.filter(c => cfg?.collectors[c.name]?.enabled);
  const [url, setUrl] = useState(cfg?.targetUrl || '');
  const [headless, setHeadless] = useState(!!cfg?.headless || forced);
  const [busy, setBusy] = useState(false);
  const [adv, setAdv] = useState({
    device: emu.device,
    network: emu.network,
    userAgent: emu.userAgent || '',
    headers: Object.entries(emu.extraHeaders || {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
    block: (emu.blockPatterns || []).join('\n')
  });
  const advOpen = emu.device !== 'desktop' || emu.network !== 'none' || !!emu.userAgent || !!adv.headers || !!(emu.blockPatterns || []).length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const lines = (v: string) => v.split('\n').map(l => l.trim()).filter(Boolean);
      const extraHeaders: Record<string, string> = {};
      for (const line of lines(adv.headers)) {
        const i = line.indexOf(':');
        if (i > 0) extraHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      const emulation: EmulationOptions = { device: adv.device, network: adv.network, userAgent: adv.userAgent.trim(), extraHeaders, blockPatterns: lines(adv.block) };
      // remember the advanced options as the new defaults
      setConfig(await api.saveConfig({ emulation }));
      const summary = await api.start({ url: url.trim() || undefined, headless, emulation });
      // the status event switches the view; set it too in case the event was missed
      setSession(summary);
    } catch (err) {
      toast(errMsg(err), 'err', 7000);
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {finished && (
        <div className="card" style={{ borderColor: 'color-mix(in srgb,var(--ok) 40%,transparent)' }}>
          <div className="row">
            <div className="feature" style={{ flex: 1 }}>
              <div className="ico" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><Icon name="check" /></div>
              <div>
                <h4>{t('live.finished')}</h4>
                <p className="ltr">{finished.id}</p>
                <p>{t('live.finished.text')}</p>
              </div>
            </div>
            <Link className="btn primary" href={`/sessions/?id=${encodeURIComponent(finished.id)}`}><Icon name="eye" />{t('live.openResults')}</Link>
          </div>
        </div>
      )}

      <section className="hero">
        <h2>{t('live.hero.title')}</h2>
        <p>{t('live.hero.text')}</p>
        <form className="start-form" id="startForm" onSubmit={submit}>
          <div className="url-wrap">
            <Icon name="globe" />
            <input className="input lg ltr" id="url" type="text" autoComplete="url" spellCheck={false} autoFocus
              placeholder={t('live.url.placeholder')} value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          <button className="btn primary lg" id="startBtn" type="submit" disabled={busy}>
            {busy ? <><Spinner /><span>{t('live.starting')}</span></> : <><Icon name="play" /><span>{t('live.start')}</span></>}
          </button>
        </form>
        <div className="start-opts">
          <label><Switch id="headless" checked={headless} disabled={forced} onChange={setHeadless} />{t('live.headless')}</label>
        </div>
        <details className="advanced" open={advOpen}>
          <summary><Icon name="settings" /><span>{t('live.advanced')}</span></summary>
          <div className="advanced-grid">
            <div className="field">
              <label htmlFor="emuDevice">{t('emu.device')}</label>
              <select className="select" id="emuDevice" value={adv.device} onChange={e => setAdv({ ...adv, device: e.target.value })}>
                {(meta?.devices || []).map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="emuNetwork">{t('emu.network')}</label>
              <select className="select" id="emuNetwork" value={adv.network} onChange={e => setAdv({ ...adv, network: e.target.value })}>
                {(meta?.networks || []).map(n => <option key={n.key} value={n.key}>{t('netp.' + n.key)}</option>)}
              </select>
            </div>
            <div className="field span-2">
              <label htmlFor="emuUa">{t('emu.userAgent')}</label>
              <input className="input ltr" id="emuUa" spellCheck={false} value={adv.userAgent} onChange={e => setAdv({ ...adv, userAgent: e.target.value })} />
              <span className="hint">{t('emu.userAgent.hint')}</span>
            </div>
            <div className="field">
              <label htmlFor="emuHeaders">{t('emu.headers')}</label>
              <textarea className="input textarea ltr" id="emuHeaders" rows={3} spellCheck={false} placeholder="X-Api-Key: …" value={adv.headers} onChange={e => setAdv({ ...adv, headers: e.target.value })} />
              <span className="hint">{t('emu.headers.hint')}</span>
            </div>
            <div className="field">
              <label htmlFor="emuBlock">{t('emu.block')}</label>
              <textarea className="input textarea ltr" id="emuBlock" rows={3} spellCheck={false} placeholder={'google-analytics.com\n*.mp4'} value={adv.block} onChange={e => setAdv({ ...adv, block: e.target.value })} />
              <span className="hint">{t('emu.block.hint')}</span>
            </div>
          </div>
          <p className="hint">{t('emu.remember')}</p>
        </details>
      </section>

      <div className="card">
        <div className="card-head">
          <h3>{t('live.enabledCollectors')}</h3>
          <span className="pill accent">{fmtNumber(enabled.length)} / {fmtNumber(collectors.length)}</span>
          <span className="spacer" />
          <Link className="btn sm ghost" href="/collectors/"><Icon name="settings" />{t('live.editCollectors')}</Link>
        </div>
        <div className="chips">
          {collectors.map(c => (
            <span key={c.name} className={`chip ${cfg?.collectors[c.name]?.enabled ? 'on' : ''}`}><Icon name={COLLECTOR_ICONS[c.name]} />{t('col.' + c.name)}</span>
          ))}
        </div>
      </div>

      <div className="features">
        {[['network', 'network'], ['mouse', 'click'], ['gauge', 'perf'], ['shield', 'sec']].map(([ic, k]) => (
          <div key={k} className="card feature">
            <div className="ico"><Icon name={ic} /></div>
            <div><h4>{t('live.features.' + k)}</h4><p>{t('live.features.' + k + '.d')}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// running session
// ---------------------------------------------------------------------------

const typeMatch = (row: NetworkRow, type: string): boolean => {
  if (type === 'all') return true;
  const rt = row.resourceType || '';
  if (type === 'xhr') return rt === 'xhr' || rt === 'fetch';
  if (type === 'other') return !['document', 'xhr', 'fetch', 'script', 'stylesheet', 'image', 'font'].includes(rt);
  return rt === type;
};

function useTicker(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN(n => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function RunningSession() {
  useStoreVersion(['counts', 'status', 'snapshot', 'snapshot-start']);
  useTicker(1000);
  const s = state.session!;
  const vp = s.viewport || state.config?.viewport || { width: 1280, height: 800 };
  const live = useRef<LiveViewClass | null>(null);
  const [navUrl, setNavUrl] = useState(s.currentUrl || s.url);
  const navFocused = useRef(false);
  const [tab, setTab] = useState<'network' | 'console' | 'logs'>('network');
  const [snapBusy, setSnapBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const isStopping = stopping || s.status === 'stopping';

  const c: Partial<SessionSummary['counts']> = s.counts || {};
  const started = new Date(s.startedAt || Date.now()).getTime();
  const stats: [string, string, number | null | undefined, string, string?][] = [
    ['network', 'stat.requests', c.requests, ''],
    ['alert', 'stat.failed', c.failedRequests, c.failedRequests ? 'err' : ''],
    ['terminal', 'stat.console', c.console, ''],
    ['alert', 'stat.errors', c.errors, c.errors ? 'err' : ''],
    ['mouse', 'stat.clicks', c.clicks, ''],
    ['camera', 'stat.snapshots', c.snapshots, 'accent'],
    ...(c.blocked ? [['x', 'stat.blocked', c.blocked, '']] as typeof stats : []),
    ['clock', 'stat.duration', null, '', fmtDuration(Date.now() - started)]
  ];

  const snapshot = async () => {
    setSnapBusy(true);
    try { await api.snapshot(); } catch (err) { toast(errMsg(err), 'err'); }
    setSnapBusy(false);
  };
  const stop = async () => {
    setStopping(true);
    try { await api.stop(); } catch (err) { toast(errMsg(err), 'err'); setStopping(false); }
  };
  const navigate = (e: FormEvent) => {
    e.preventDefault();
    live.current?.navigate(navUrl);
    live.current?.el.focus();
  };

  const snaps = [...(s.snapshots || [])].reverse();
  const pending = state.live.pending;
  const shortId = s.id.split('-').slice(2, -1).join('-') || s.id;

  return (
    <div className="stack">
      <div className="stats" id="stats">
        {stats.map(([ic, label, v, cls, text]) => <Stat key={label} icon={ic} label={t(label)} value={text ?? fmtNumber(v ?? 0)} cls={cls} />)}
      </div>

      <div className="live-grid">
        <div className="browser">
          <div className="browser-bar">
            <button className="icon-btn" title={t('live.back')} onClick={() => live.current?.history('back')}><Icon name="left" /></button>
            <button className="icon-btn" title={t('live.forward')} onClick={() => live.current?.history('forward')}><Icon name="right" /></button>
            <button className="icon-btn" title={t('live.reload')} onClick={() => live.current?.history('reload')}><Icon name="refresh" /></button>
            <form id="navForm" style={{ flex: 1, display: 'flex', gap: 6 }} onSubmit={navigate}>
              <input className="input" id="navUrl" spellCheck={false} value={navUrl} onChange={e => setNavUrl(e.target.value)}
                onFocus={() => { navFocused.current = true; }} onBlur={() => { navFocused.current = false; }} />
            </form>
            <button className="btn sm" id="snapBtn" disabled={snapBusy || isStopping} onClick={snapshot}><Icon name="camera" /><span>{t('live.snapshot')}</span></button>
            <a className="btn sm ghost" href={api.liveHarUrl()} download title={t('live.har')}><Icon name="download" /><span>HAR</span></a>
            <button className="btn sm danger" id="stopBtn" disabled={isStopping} onClick={stop}>
              {isStopping ? <><Spinner /><span>{t('live.stopping')}</span></> : <><Icon name="stop" /><span>{t('live.stop')}</span></>}
            </button>
          </div>
          <LiveCanvas
            id="viewport"
            style={{ '--lv-ratio': `${vp.width} / ${vp.height}`, '--lv-w': vp.width, '--lv-h': vp.height } as React.CSSProperties}
            onReady={v => { live.current = v; }}
            options={{
              onNavigated: url => { if (!navFocused.current) setNavUrl(url); },
              onError: message => toast(message, 'err')
            }}
          />
          <div className="browser-foot">
            <Icon name="keyboard" />
            <span>{s.headless ? t('live.preview.hint') : t('live.preview.headed') + ' ' + t('live.preview.hint')}</span>
            <EmulationPills session={s} />
          </div>
        </div>

        <div className="side-col">
          <div className="card">
            <div className="card-head"><h3>{t('live.timeline')}</h3><span className="spacer" /><span className="pill" id="sessionId" title={s.id}>{shortId}</span></div>
            <div className="timeline" id="timeline">
              {!snaps.length && !pending && <Empty icon="camera" className="small">{t('live.timeline.empty')}</Empty>}
              {pending && (
                <div className="tl-item pending">
                  <div className={`ico ${pending.reason}`}><Spinner /></div>
                  <div className="body"><div className="title">#{pending.seq} · {t('reason.' + pending.reason)}</div><div className="sub">{t('common.loading')}</div></div>
                </div>
              )}
              {snaps.map(sn => (
                <div key={sn.seq} className="tl-item">
                  <div className={`ico ${sn.reason}`}><Icon name={sn.reason === 'click' ? 'mouse' : sn.reason === 'final' ? 'check' : 'camera'} /></div>
                  <div className="body">
                    <div className="title">#{sn.seq} · {t('reason.' + sn.reason)} <span className="muted small">{fmtTime(sn.createdAt)}</span></div>
                    <div className="sub truncate ltr">{sn.click ? `<${sn.click.tagName.toLowerCase()}> ${sn.click.cssSelector || ''}` : sn.url}</div>
                    <div className="sub">
                      {fmtDuration(sn.durationMs)}
                      {Object.keys(sn.errors || {}).length > 0 && <> · <span style={{ color: 'var(--err)' }}>{Object.keys(sn.errors).length} {t('common.error')}</span></>}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    {sn.screenshot && <button className="icon-btn" title="screenshot" onClick={() => openScreenshot(s.id, sn.screenshot!)}><Icon name="image" /></button>}
                    <button className="icon-btn" title="JSON" onClick={() => openJsonFile(s.id, sn.file)}><Icon name="code" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="tabs" id="tabs">
          <button data-tab="network" className={tab === 'network' ? 'active' : ''} onClick={() => setTab('network')}>
            <Icon name="network" />{t('tab.network')}<span className="count">{fmtNumber(state.live.order.length)}</span>
          </button>
          <button data-tab="console" className={tab === 'console' ? 'active' : ''} onClick={() => setTab('console')}>
            <Icon name="terminal" />{t('tab.console')}<span className="count">{fmtNumber(state.live.console.length)}</span>
          </button>
          <button data-tab="logs" className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}><Icon name="activity" />{t('tab.logs')}</button>
        </div>
        {tab === 'network' && <NetworkPanel sessionId={s.id} />}
        {tab === 'console' && <ConsolePanel />}
        {tab === 'logs' && <LogsPanel />}
      </div>
    </div>
  );
}

function NetworkPanel({ sessionId }: { sessionId: string }) {
  const version = useStoreVersion(['request', 'response', 'status']);
  const [filter, setFilter] = useState('');
  const [type, setType] = useState('all');
  const rows = useMemo(() => {
    const f = filter.toLowerCase();
    const out: NetworkRow[] = [];
    const order = state.live.order;
    for (let i = order.length - 1; i >= 0 && out.length < 500; i--) {
      const r = state.live.rows.get(order[i]);
      if (!r || !r.url) continue;
      if (f && !r.url.toLowerCase().includes(f)) continue;
      if (!typeMatch(r, type)) continue;
      out.push(r);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, type, version]);

  return (
    <>
      <div className="toolbar">
        <input className="input" id="netFilter" placeholder={t('net.filter')} value={filter} onChange={e => setFilter(e.target.value)} />
        <Seg id="netType" value={type} onChange={setType} options={NET_TYPES.map(([k, l]) => ({ key: k, label: l.includes('.') ? t(l) : l }))} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('net.method')}</th><th>{t('net.status')}</th><th>{t('net.type')}</th><th>{t('net.size')}</th><th>{t('net.time')}</th><th>{t('net.url')}</th></tr></thead>
          <tbody id="netBody">
            {!rows.length && <tr><td colSpan={6} className="empty">{t('net.empty')}</td></tr>}
            {rows.map(r => {
              const resp = r.response;
              return (
                <tr key={r.id} className="clickable" data-id={r.id} onClick={() => openLiveRequest(sessionId, r.id)}>
                  <td><span className="method">{r.method}</span></td>
                  <td>
                    {r.failure ? <span className="status-code sx">ERR</span>
                      : resp ? <span className={`status-code ${statusClass(resp.status)}`}>{resp.status}</span>
                      : <span className="muted small">{t('net.pending')}</span>}
                  </td>
                  <td className="muted">{r.resourceType}</td>
                  <td className="muted mono">{resp ? fmtBytes(resp.size) : ''}</td>
                  <td className="muted mono">{fmtTime(r.timestamp)}</td>
                  <td className="url" title={r.url}>{r.url}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ConsolePanel() {
  useStoreVersion(['console']);
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState('all');
  const f = filter.toLowerCase();
  const lines = state.live.console.filter(m => {
    if (level === 'error' && m.type !== 'error') return false;
    if (level === 'warn' && m.type !== 'warn') return false;
    if (level === 'log' && !['log', 'info', 'debug'].includes(m.type)) return false;
    return !f || (m.text || '').toLowerCase().includes(f);
  }).slice(-500).reverse();
  return (
    <>
      <div className="toolbar">
        <input className="input" id="conFilter" placeholder={t('console.filter')} value={filter} onChange={e => setFilter(e.target.value)} />
        <Seg id="conLevel" value={level} onChange={setLevel} options={['all', 'error', 'warn', 'log'].map(k => ({ key: k, label: k === 'all' ? t('net.all') : k }))} />
      </div>
      <div className="console" id="conBody"><ConsoleLines lines={lines} /></div>
    </>
  );
}

function LogsPanel() {
  useStoreVersion(['log']);
  const lines = state.live.logs.slice(-300).reverse();
  return (
    <div className="console" id="logBody">
      {!lines.length && <div className="empty">{t('common.noData')}</div>}
      {lines.map((l, i) => (
        <div key={i} className={`line ${l.level === 'ERROR' ? 'error' : l.level === 'WARN' ? 'warn' : 'info'}`}>
          <span className="t">{fmtTime(l.timestamp)}</span><span className="lvl">{l.level}</span><span>{l.message}</span>
        </div>
      ))}
    </div>
  );
}
