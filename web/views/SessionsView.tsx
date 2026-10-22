'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ConsoleLines, RequestDetails, openJsonFile, openScreenshot } from '@/components/Details';
import { COLLECTOR_ICONS, Icon } from '@/components/Icon';
import { JsonView } from '@/components/JsonView';
import { Empty, EmulationPills, Seg, Spinner, Stat, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, fmtBytes, fmtDuration, hostOf, statusClass } from '@/lib/format';
import { fmtDate, fmtNumber, fmtTime, getLang, t } from '@/lib/i18n';
import { state } from '@/lib/store';
import type { Analysis, ConsoleLine, FileEntry, NetworkResponse, SearchMatch, SessionSummary } from '@/lib/types';
import { askAssistant, openDrawer, toast, useHeader } from '@/lib/ui';

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export function SessionsList() {
  useHeader(t('sessions.title'), t('sessions.subtitle'));
  const router = useRouter();
  const [all, setAll] = useState<SessionSummary[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.sessions().then(setAll).catch(err => { toast(errMsg(err), 'err'); setAll([]); });
  }, []);

  const remove = async (id: string) => {
    if (!confirm(t('sessions.delete.confirm'))) return;
    try {
      await api.deleteSession(id);
      setAll(list => (list || []).filter(s => s.id !== id));
      toast(t('sessions.deleted'), 'ok');
    } catch (err) {
      toast(errMsg(err), 'err');
    }
  };

  if (!all) return <Empty>{t('common.loading')}</Empty>;
  if (!all.length) {
    return (
      <div className="card empty">
        <Icon name="archive" /><div>{t('sessions.empty')}</div>
        <div style={{ marginTop: 14 }}><Link className="btn primary" href="/"><Icon name="play" />{t('sessions.empty.cta')}</Link></div>
      </div>
    );
  }
  const f = filter.toLowerCase();
  const list = all.filter(s => !f || s.url.toLowerCase().includes(f));
  const open = (id: string) => router.push(`/sessions/?id=${encodeURIComponent(id)}`);

  return (
    <>
      <div className="toolbar">
        <input className="input" id="q" placeholder={t('sessions.search')} value={filter} onChange={e => setFilter(e.target.value)} />
        <span className="spacer" />
        <span className="muted small">{t('common.items', { n: fmtNumber(list.length) })}</span>
      </div>
      <div className="session-list">
        {list.map(s => (
          <div key={s.id} className="session-row" data-id={s.id} onClick={() => open(s.id)}>
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="host">{hostOf(s.url)}</span>
                <StatusPill status={s.status} />
                {s.headless && <span className="pill">headless</span>}
                <EmulationPills session={s} />
              </div>
              <div className="url truncate">{s.url}</div>
              <div className="muted small">{fmtDate(s.startedAt)}{s.endedAt ? ' · ' + fmtDuration(Date.parse(s.endedAt) - Date.parse(s.startedAt)) : ''}</div>
            </div>
            <div className="metrics">
              <span title={t('stat.requests')}><Icon name="network" />{fmtNumber(s.counts?.requests ?? 0)}</span>
              <span title={t('stat.console')}><Icon name="terminal" />{fmtNumber(s.counts?.console ?? 0)}</span>
              <span title={t('stat.errors')} style={s.counts?.errors ? { color: 'var(--err)' } : undefined}><Icon name="alert" />{fmtNumber(s.counts?.errors ?? 0)}</span>
              <span title={t('stat.snapshots')}><Icon name="camera" />{fmtNumber(s.counts?.snapshots ?? 0)}</span>
            </div>
            <div className="actions" onClick={e => e.stopPropagation()}>
              {s.analysisFile && <a className="icon-btn" title={t('sessions.download')} href={api.fileUrl(s.id, 'analysis.json', true)}><Icon name="download" /></a>}
              <button className="icon-btn" title={t('common.delete')} data-del={s.id} onClick={() => remove(s.id)}><Icon name="trash" /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'snapshots' | 'network' | 'console' | 'search' | 'modules' | 'files';
const TABS: [Tab, string][] = [['overview', 'activity'], ['snapshots', 'camera'], ['network', 'network'], ['console', 'terminal'], ['search', 'search'], ['modules', 'layers'], ['files', 'folder']];

export function SessionDetail({ id }: { id: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  useHeader(summary ? hostOf(summary.url) : t('sessions.title'), summary ? fmtDate(summary.startedAt) : id);

  useEffect(() => {
    (async () => {
      let s: SessionSummary;
      try {
        s = await api.savedSession(id);
      } catch {
        setMissing(true);
        return;
      }
      if (s.analysisFile) {
        try { setAnalysis(await api.json(id, 'analysis.json')); } catch (err) { toast(errMsg(err), 'err'); }
      }
      setSummary(s);
    })();
  }, [id]);

  if (missing) {
    return (
      <div className="card empty">
        <Icon name="alert" /><div>{t('sessions.notFound')}</div>
        <div style={{ marginTop: 12 }}><Link className="btn" href="/sessions/">{t('sessions.back')}</Link></div>
      </div>
    );
  }
  if (!summary) return <Empty>{t('common.loading')}</Empty>;

  const action = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast(errMsg(e), 'err'); }
    setBusy(null);
  };
  const remove = async () => {
    if (!confirm(t('sessions.delete.confirm'))) return;
    try {
      await api.deleteSession(id);
      toast(t('sessions.deleted'), 'ok');
      router.push('/sessions/');
    } catch (err) { toast(errMsg(err), 'err'); }
  };
  const lang = getLang();

  return (
    <>
      <div className="detail-head">
        <div className="meta">
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <Link className="btn sm ghost" href="/sessions/"><Icon name={lang === 'fa' ? 'right' : 'left'} />{t('sessions.back')}</Link>
            <StatusPill status={summary.status} />
          </div>
          <h2>{analysis?.elements?.overview?.title || hostOf(summary.url)}</h2>
          <div className="url">{summary.url}</div>
          <div className="row" style={{ gap: 6, margin: '4px 0' }}><EmulationPills session={summary} /></div>
          <div className="muted small">{t('sessions.started')}: {fmtDate(summary.startedAt)}{summary.endedAt ? ` · ${t('sessions.ended')}: ${fmtDate(summary.endedAt)}` : ''}</div>
        </div>
        <div className="row">
          {summary.analysisFile && (
            <>
              <a className="btn primary" target="_blank" rel="noopener" href={api.reportUrl(id, lang)}><Icon name="file" />{t('sessions.report')}</a>
              <a className="btn" href={api.reportUrl(id, lang, true)} title={t('sessions.reportDownload')}><Icon name="download" />HTML</a>
            </>
          )}
          {summary.exports?.har && <a className="btn" href={api.fileUrl(id, summary.exports.har, true)} title={t('sessions.har')}><Icon name="download" />HAR</a>}
          {summary.analysisFile && <a className="btn" href={api.fileUrl(id, 'analysis.json', true)} title={t('sessions.download')}><Icon name="download" />JSON</a>}
          <button className="btn" id="askBtn" onClick={() => askAssistant(t('sessions.askAi.prompt', { id, url: summary.url }), router.push)}><Icon name="zap" />{t('sessions.askAi')}</button>
          {summary.analysisFile && summary.status === 'finished' && (
            <button className="btn ghost" id="archiveBtn" disabled={busy === 'archive'} onClick={() => action('archive', async () => {
              const r = await api.archiveSession(id);
              toast(t('sessions.archived', { n: fmtNumber(r.files?.uploaded ?? 0) }), 'ok');
            })}><Icon name="upload" />{t('sessions.archive')}</button>
          )}
          {summary.analysisFile && (
            <button className="btn ghost" id="graphBtn" disabled={busy === 'graph'} onClick={() => action('graph', async () => {
              const r = await api.graphSync(id);
              toast(t('sessions.graphSynced', { n: fmtNumber(r.requests) }), 'ok');
            })}><Icon name="share" />{t('sessions.graphSync')}</button>
          )}
          <button className="btn danger" id="delBtn" onClick={remove}><Icon name="trash" />{t('common.delete')}</button>
        </div>
      </div>
      {summary.error && <div className="card" style={{ borderColor: 'var(--err)', marginBottom: 16, color: 'var(--err)' }}><Icon name="alert" /> {summary.error}</div>}
      <div className="tabs" id="dTabs">
        {TABS.filter(([k]) => analysis || k === 'files' || k === 'overview' || k === 'snapshots').map(([k, ic]) => (
          <button key={k} data-tab={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><Icon name={ic} />{t('tab.' + k)}</button>
        ))}
      </div>
      <div id="dPanel">
        {tab === 'overview' && <Overview id={id} summary={summary} analysis={analysis} />}
        {tab === 'snapshots' && <Snapshots id={id} summary={summary} />}
        {tab === 'network' && <SavedNetwork id={id} analysis={analysis} />}
        {tab === 'console' && <SavedConsole analysis={analysis} />}
        {tab === 'search' && <Search id={id} analysis={analysis} />}
        {tab === 'modules' && <Modules id={id} analysis={analysis} />}
        {tab === 'files' && <Files id={id} />}
      </div>
    </>
  );
}

function Card({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return <div className="card"><div className="card-head"><Icon name={icon} /><h3>{title}</h3></div>{children}</div>;
}

function KV({ rows }: { rows: ([string, ReactNode] | null | false | undefined)[] }) {
  return (
    <dl className="kv">
      {rows.filter((r): r is [string, ReactNode] => !!r).map(([k, v]) => <FragmentKV key={k} k={k} v={v} />)}
    </dl>
  );
}
const FragmentKV = ({ k, v }: { k: string; v: ReactNode }) => <><dt>{k}</dt><dd>{v}</dd></>;

function Overview({ id, summary, analysis }: { id: string; summary: SessionSummary; analysis: Analysis | null }) {
  const c: Partial<SessionSummary['counts']> = summary.counts || {};
  const a: Analysis = analysis || {};
  const ov = a.elements?.overview;
  const sec = a.security;
  const perf = a.performance;
  const nav = perf?.timing?.navigation;
  const ms = (v: number | null | undefined) => (v == null ? '—' : t('common.ms', { n: fmtNumber(v) }));
  const yesNo = (b: unknown) => (b ? <span className="pill ok">{t('ins.yes')}</span> : <span className="pill err">{t('ins.no')}</span>);
  const devFiles = ([
    perf?.tracePath ? [t('ins.trace'), perf.tracePath] : null,
    a.memory?.heapSnapshotPath ? [t('ins.heapFile'), a.memory.heapSnapshotPath] : null
  ] as ([string, string] | null)[]).filter((f): f is [string, string] => !!f);
  const stats: [string, string, number | undefined, string?][] = [
    ['network', 'stat.requests', c.requests], ['alert', 'stat.failed', c.failedRequests, c.failedRequests ? 'err' : ''],
    ['terminal', 'stat.console', c.console], ['alert', 'stat.errors', c.errors, c.errors ? 'err' : ''],
    ['mouse', 'stat.clicks', c.clicks], ['camera', 'stat.snapshots', c.snapshots, 'accent']
  ];

  return (
    <div className="stack">
      <div className="stats">{stats.map(([ic, l, v, cls]) => <Stat key={l} icon={ic} label={t(l)} value={fmtNumber(v ?? 0)} cls={cls} />)}</div>
      {!analysis && <div className="card muted">{t('sessions.noAnalysis')}</div>}
      <div className="chips">{(summary.collectors || []).map(n => <span key={n} className="chip on"><Icon name={COLLECTOR_ICONS[n]} />{t('col.' + n)}</span>)}</div>
      <div className="insights">
        {ov && <Card icon="code" title={t('ins.page')}><KV rows={[
          [t('ins.title'), ov.title || '—'], [t('ins.elements'), fmtNumber(ov.elementCount)], [t('ins.forms'), fmtNumber(ov.forms?.length ?? 0)],
          [t('ins.links'), fmtNumber(ov.links)], ['lang / dir', `${ov.lang || '—'} / ${ov.dir || '—'}`]
        ]} /></Card>}
        {sec && <Card icon="shield" title={t('ins.security')}>
          <KV rows={[
            [t('ins.secure'), yesNo(sec.isSecureContext)],
            sec.certificate ? [t('ins.issuer'), sec.certificate.issuer || '—'] : null,
            sec.certificate ? ['TLS', sec.certificate.protocol || '—'] : null,
            [t('ins.mixed'), fmtNumber(sec.mixedContent?.length ?? 0)],
            [t('ins.cookieIssues'), fmtNumber(sec.cookieIssues?.length ?? 0)]
          ]} />
          <div className="small muted" style={{ margin: '12px 0 6px' }}>{t('ins.missingHeaders')}</div>
          <div className="chips">
            {(sec.missingHeaders || []).length
              ? sec.missingHeaders.map((h: string) => <span key={h} className="chip" style={{ color: 'var(--warn)' }}>{h}</span>)
              : <span className="pill ok">{t('ins.none')}</span>}
          </div>
        </Card>}
        {perf && <Card icon="gauge" title={t('ins.performance')}><KV rows={[
          [t('ins.ttfb'), ms(nav?.ttfb)], [t('ins.dcl'), ms(nav?.domContentLoaded)], [t('ins.load'), ms(nav?.load)],
          [t('ins.fcp'), ms(perf.timing?.paint?.['first-contentful-paint'])], [t('ins.lcp'), ms(perf.timing?.largestContentfulPaint?.time)],
          [t('ins.cls'), String(perf.timing?.cumulativeLayoutShift ?? '—')],
          perf.metrics ? [t('ins.heap'), fmtBytes(perf.metrics.JSHeapUsedSize)] : null
        ]} /></Card>}
        {a.accessibility && <Card icon="a11y" title={t('ins.a11y')}><KV rows={[
          [t('ins.a11yNodes'), fmtNumber(a.accessibility.visibleNodes)],
          [t('ins.a11yIssues'), a.accessibility.issueCount ? <span style={{ color: 'var(--warn)' }}>{fmtNumber(a.accessibility.issueCount)}</span> : fmtNumber(0)]
        ]} /></Card>}
        {(a.scripts || a.css) && <Card icon="file" title={t('ins.sources')}><KV rows={[
          a.scripts ? [t('ins.scripts'), fmtNumber(a.scripts.external?.length ?? 0)] : null,
          a.scripts ? [t('ins.inline'), fmtNumber(a.scripts.inlineCount ?? 0)] : null,
          a.css ? [t('ins.stylesheets'), fmtNumber(a.css.stylesheets?.length ?? 0)] : null
        ]} /></Card>}
        {a.application && <Card icon="database" title={t('ins.storage')}><KV rows={[
          [t('ins.cookies'), fmtNumber(a.application.cookies?.length ?? 0)],
          [t('ins.local'), fmtNumber(Object.keys(a.application.storageInfo?.localStorage || {}).length)],
          [t('ins.idb'), fmtNumber(Object.keys(a.application.storageInfo?.indexedDB || {}).length)]
        ]} /></Card>}
        {devFiles.length > 0 && <Card icon="download" title="DevTools">
          <p className="muted small" style={{ marginTop: 0 }}>{t('ins.devtoolsHint')}</p>
          <ul className="list-plain">
            {devFiles.map(([label, p]) => (
              <li key={p}><Icon name="file" /><span style={{ flex: 1 }}>{label}</span><a className="btn sm" href={api.fileUrl(id, p, true)}><Icon name="download" />{t('common.download')}</a></li>
            ))}
          </ul>
        </Card>}
      </div>
    </div>
  );
}

function Snapshots({ id, summary }: { id: string; summary: SessionSummary }) {
  const snaps = summary.snapshots || [];
  if (!snaps.length) return <div className="card empty"><Icon name="camera" /><div>{t('live.timeline.empty')}</div></div>;
  return (
    <div className="gallery">
      {snaps.map(s => (
        <div key={s.seq} className="shot">
          {s.screenshot
            ? <img loading="lazy" src={api.fileUrl(id, s.screenshot)} alt="" onClick={() => openScreenshot(id, s.screenshot!)} />
            : <div className="noimg"><Icon name="image" /></div>}
          <div className="info">
            <div className="row"><strong>#{s.seq} · {t('reason.' + s.reason)}</strong><span className="muted small">{fmtTime(s.createdAt)}</span></div>
            {s.click
              ? <div className="small truncate ltr" title={s.click.cssSelector || ''}>{t('sessions.click')} &lt;{s.click.tagName.toLowerCase()}&gt; {s.click.innerText || s.click.cssSelector || ''}</div>
              : <div className="small muted truncate ltr">{s.url}</div>}
            <div className="row" style={{ justifyContent: 'flex-start', gap: 6 }}>
              <button className="btn sm" onClick={() => openJsonFile(id, s.file)}><Icon name="code" />{t('sessions.openJson')}</button>
              {s.html && <a className="btn sm ghost" target="_blank" rel="noopener" href={api.fileUrl(id, s.html)}><Icon name="external" />{t('sessions.openHtml')}</a>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function showSavedRequest(id: string, analysis: Analysis | null, requestId: string) {
  const r = (analysis?.network?.requests || []).find(x => x.id === requestId);
  if (!r) return;
  const resp = (analysis?.network?.responses || []).find(x => x.requestId === requestId) || null;
  openDrawer(`${r.method} ${hostOf(r.url)}`, <RequestDetails sessionId={id} request={r} response={resp} />);
}

function SavedNetwork({ id, analysis }: { id: string; analysis: Analysis | null }) {
  const [filter, setFilter] = useState('');
  const [type, setType] = useState('all');
  const reqs = analysis?.network?.requests || [];
  const resps = useMemo(() => new Map<string, NetworkResponse>((analysis?.network?.responses || []).map(r => [r.requestId, r])), [analysis]);
  const f = filter.toLowerCase();
  const rows = reqs.filter(r => (!f || r.url.toLowerCase().includes(f)) && (type === 'all'
    || (type === 'xhr' ? ['xhr', 'fetch'].includes(r.resourceType)
      : type === 'other' ? !['document', 'xhr', 'fetch', 'script', 'stylesheet', 'image'].includes(r.resourceType)
        : r.resourceType === type))).slice(0, 2000);
  return (
    <>
      <div className="toolbar">
        <input className="input" id="nf" placeholder={t('net.filter')} value={filter} onChange={e => setFilter(e.target.value)} />
        <Seg id="nt" value={type} onChange={setType} options={['all', 'document', 'xhr', 'script', 'stylesheet', 'image', 'other'].map(k => ({ key: k, label: k === 'all' ? t('net.all') : k }))} />
      </div>
      <div className="table-wrap" style={{ maxHeight: 640 }}>
        <table className="table">
          <thead><tr><th>{t('net.method')}</th><th>{t('net.status')}</th><th>{t('net.type')}</th><th>{t('net.size')}</th><th>{t('net.time')}</th><th>{t('net.url')}</th></tr></thead>
          <tbody id="nb">
            {!rows.length && <tr><td colSpan={6} className="empty">{t('net.empty')}</td></tr>}
            {rows.map(r => {
              const resp = resps.get(r.id);
              return (
                <tr key={r.id} className="clickable" data-id={r.id} onClick={() => showSavedRequest(id, analysis, r.id)}>
                  <td><span className="method">{r.method}</span></td>
                  <td>{r.failure ? <span className="status-code sx">ERR</span> : resp ? <span className={`status-code ${statusClass(resp.status)}`}>{resp.status}</span> : '—'}</td>
                  <td className="muted">{r.resourceType}</td>
                  <td className="muted mono">{resp ? fmtBytes(resp.size) : ''}</td>
                  <td className="muted mono">{resp?.durationMs != null ? fmtDuration(resp.durationMs) : ''}</td>
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

function SavedConsole({ analysis }: { analysis: Analysis | null }) {
  const c = analysis?.console || { logs: [], pageErrors: [], dialogs: [] };
  const lines: ConsoleLine[] = [
    ...c.logs,
    ...c.pageErrors.map(e => ({ timestamp: e.timestamp, type: 'error', text: e.message, stack: e.stack, pageError: true })),
    ...c.dialogs.map(d => ({ timestamp: d.timestamp, type: 'info', text: `[dialog:${d.type}] ${d.message}` }))
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return <div className="console" style={{ maxHeight: 680 }}><ConsoleLines lines={lines} /></div>;
}

const KIND_ICONS: Record<string, string> = {
  url: 'globe', request: 'network', response: 'network', console: 'terminal', cookie: 'database', storage: 'database', source: 'file'
};

function Search({ id, analysis }: { id: string; analysis: Analysis | null }) {
  const [q, setQ] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCase] = useState(false);
  const [result, setResult] = useState<{ matches: SearchMatch[]; truncated: boolean } | { error: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    try {
      const res = await api.search(id, q, { regex, caseSensitive });
      setResult(res.error ? { error: res.error } : { matches: res.matches, truncated: res.truncated });
    } catch (err) {
      setResult({ error: errMsg(err) });
    }
    setLoading(false);
  };

  const openMatch = (m: SearchMatch) => {
    if (m.requestId) showSavedRequest(id, analysis, m.requestId);
    else if (m.file) window.open(api.fileUrl(id, m.file), '_blank', 'noopener');
  };

  return (
    <>
      <form className="toolbar" id="sf" onSubmit={submit}>
        <input className="input" id="sq" style={{ maxWidth: 'none', flex: 1, minWidth: 220 }} placeholder={t('search.placeholder')} value={q} onChange={e => setQ(e.target.value)} spellCheck={false} autoFocus />
        <label className="row small" style={{ gap: 6, cursor: 'pointer' }}><input type="checkbox" id="sRegex" checked={regex} onChange={e => setRegex(e.target.checked)} />{t('search.regex')}</label>
        <label className="row small" style={{ gap: 6, cursor: 'pointer' }}><input type="checkbox" id="sCase" checked={caseSensitive} onChange={e => setCase(e.target.checked)} />{t('search.case')}</label>
        <button className="btn primary sm" type="submit"><Icon name="search" />{t('search.go')}</button>
      </form>
      <div id="sr">
        {loading ? <div className="empty"><Spinner /></div>
          : !result ? <Empty icon="search" className="small">{t('search.hint')}</Empty>
          : 'error' in result ? <div className="card" style={{ color: 'var(--err)' }}>{result.error}</div>
          : !result.matches.length ? <Empty icon="search">{t('search.none')}</Empty>
          : (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="pill accent">{t('search.count', { n: fmtNumber(result.matches.length) })}</span>
                {result.truncated && <span className="muted small">{t('search.truncated')}</span>}
              </div>
              <div className="search-results">
                {result.matches.map((m, i) => (
                  <div key={i} className="search-hit">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="pill"><Icon name={KIND_ICONS[m.kind] || 'file'} />{t('kind.' + m.kind)}</span>
                      <span className="muted small ltr">{m.where}</span>
                      <span className="spacer" />
                      {(m.requestId || m.file) && <button className="btn sm ghost" onClick={() => openMatch(m)}><Icon name="eye" />{t('search.open')}</button>}
                    </div>
                    {m.title && <div className="hit-title ltr truncate" title={m.title}>{m.title}</div>}
                    <div className="hit-snippet ltr">{m.snippet.slice(0, m.start)}<mark>{m.snippet.slice(m.start, m.end)}</mark>{m.snippet.slice(m.end)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
      </div>
    </>
  );
}

function Modules({ id, analysis }: { id: string; analysis: Analysis | null }) {
  const modules = analysis ? (state.meta?.collectors || []).filter(c => analysis[c.name] !== undefined) : [];
  const [active, setActive] = useState(modules[0]?.name || '');
  const [mode, setMode] = useState<'tree' | 'raw'>('tree');
  const [expanded, setExpanded] = useState(0);
  if (!modules.length) return <div className="card empty">{t('common.noData')}</div>;
  const data = analysis?.[active];
  const raw = mode === 'raw' ? JSON.stringify(data, null, 2) : '';
  return (
    <div className="module-layout">
      <div className="module-list" id="ml">
        {modules.map(m => (
          <button key={m.name} className={m.name === active ? 'active' : ''} onClick={() => { setActive(m.name); setExpanded(0); }}>
            <Icon name={COLLECTOR_ICONS[m.name]} />{t('col.' + m.name)}
          </button>
        ))}
      </div>
      <div className="stack" style={{ gap: 10, minWidth: 0 }}>
        <div className="row">
          <strong>{active}/{active}.json</strong><span className="spacer" />
          <Seg value={mode} onChange={setMode} options={[{ key: 'tree', label: t('common.tree') }, { key: 'raw', label: t('common.raw') }]} />
          <button className="btn sm ghost" onClick={() => mode === 'tree' && setExpanded(n => n + 1)}>{t('common.expandAll')}</button>
          <a className="btn sm" href={api.fileUrl(id, `${active}/${active}.json`, true)}><Icon name="download" />{t('common.download')}</a>
        </div>
        <div id="mView">
          {mode === 'raw'
            ? <pre className="code" style={{ maxHeight: 640 }}>{raw.length > 2_000_000 ? raw.slice(0, 2_000_000) + '\n…' : raw}</pre>
            : <JsonView key={`${active}:${expanded}`} data={data} depth={2} expanded={expanded > 0} />}
        </div>
      </div>
    </div>
  );
}

function Files({ id }: { id: string }) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.files(id).then(setFiles).catch(e => setError(errMsg(e)));
  }, [id]);
  if (error) return <div className="empty">{error}</div>;
  if (!files) return <div className="empty">{t('common.loading')}</div>;
  return (
    <div className="table-wrap" style={{ maxHeight: 680 }}>
      <table className="table">
        <thead><tr><th>{t('tab.files')}</th><th>{t('net.size')}</th><th></th></tr></thead>
        <tbody>
          {files.map(f => (
            <tr key={f.path}>
              <td className="url" title={f.path}>{f.path}</td>
              <td className="muted mono">{fmtBytes(f.size)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <a className="btn sm ghost" target="_blank" rel="noopener" href={api.fileUrl(id, f.path)}><Icon name="external" /></a>
                <a className="btn sm ghost" href={api.fileUrl(id, f.path, true)}><Icon name="download" /></a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
