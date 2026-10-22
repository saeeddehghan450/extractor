'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { QueryResultView } from '@/components/QueryResult';
import { Empty, Spinner, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/format';
import { labelColor } from '@/lib/forceGraph';
import { fmtNumber, hasKey, t } from '@/lib/i18n';
import type { GraphStatus, Insight, QueryResult } from '@/lib/types';
import { askAssistant, toast, useHeader } from '@/lib/ui';

const EXAMPLES: { key: string; cypher: string }[] = [
  { key: 'graph.ex.domains', cypher: 'MATCH (s:Session)-[c:CONTACTED]->(d:Domain)\nRETURN s, c, d LIMIT 100' },
  { key: 'graph.ex.thirdParty', cypher: 'MATCH (s:Session)-[c:CONTACTED]->(d:Domain)\nWHERE c.thirdParty\nRETURN d.name AS domain, count(s) AS sessions, sum(c.requests) AS requests\nORDER BY requests DESC LIMIT 25' },
  { key: 'graph.ex.scripts', cypher: 'MATCH (p:Page)-[l:LOADS]->(x)-[r:SERVED_FROM]->(d:Domain)\nRETURN p, l, x, r, d LIMIT 150' },
  { key: 'graph.ex.records', cypher: 'MATCH (x:Scrape)-[h:HAS_RECORD]->(r:Record)\nOPTIONAL MATCH (r)-[l:LINKS_TO]->(p:Page)\nRETURN x, h, r, l, p LIMIT 150' }
];

const tOr = (key: string, fallback: string) => (hasKey(key) ? t(key) : fallback);

type ResultState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; result: QueryResult; title?: string; seq: number };

export function GraphView() {
  useHeader(t('graph.title'), t('graph.subtitle'));
  const router = useRouter();
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);
  const [cypher, setCypher] = useState(EXAMPLES[0].cypher);
  const [lastQuery, setLastQuery] = useState(EXAMPLES[0].cypher);
  const [result, setResult] = useState<ResultState>({ kind: 'idle' });
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [activeInsight, setActiveInsight] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [syncing, setSyncing] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.graphStatus());
    } catch (e) {
      setStatus({ enabled: false, connected: false, uri: '', user: '', database: null, autoSync: true, source: 'none', hasPassword: false, error: errMsg(e) });
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!status?.connected) return;
    api.graphInsights().then(setInsights).catch(e => toast(errMsg(e), 'err'));
  }, [status?.connected]);

  const run = async (q = cypher) => {
    const text = q.trim();
    if (!text) return;
    setLastQuery(text);
    setResult({ kind: 'loading' });
    try {
      setResult({ kind: 'ok', result: await api.graphQuery(text), seq: Date.now() });
    } catch (e) {
      setResult({ kind: 'error', message: errMsg(e) });
    }
  };

  const runInsight = async (i: Insight) => {
    setActiveInsight(i.id);
    setResult({ kind: 'loading' });
    try {
      const r = await api.graphInsight(i.id);
      const q = r.cypher.replace(/^ {6}/gm, '');
      setCypher(q);
      setLastQuery(q);
      setResult({ kind: 'ok', result: r, title: tOr(`graph.insight.${i.id}`, r.insight.title), seq: Date.now() });
    } catch (e) {
      setResult({ kind: 'error', message: errMsg(e) });
    }
  };

  const syncAll = async () => {
    setSyncing(true);
    try {
      const r = await api.graphSyncAll();
      toast(t('graph.synced', { n: r.synced.length }), r.failed.length ? 'info' : 'ok');
      if (r.failed.length) toast(r.failed.map(f => `${f.sessionId}: ${f.error}`).join('\n'), 'err', 6000);
    } catch (e) {
      toast(errMsg(e), 'err');
    }
    setSyncing(false);
    await loadStatus();
  };

  const sendAsk = () => {
    const q = ask.trim();
    if (q) askAssistant(t('graph.ask.prefix') + q, router.push);
  };

  const s = status;
  const showSetup = setupOpen ?? (!!s && !s.connected);
  const counts = s?.nodes ? Object.entries(s.nodes).filter(([, n]) => n > 0) : [];

  return (
    <div className="stack">
      <div className="card" id="gStatusCard">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <Icon name="database" /><h3>Neo4j</h3>
          {!s ? <span className="pill"><Spinner /></span>
            : s.connected ? <span className="pill ok"><span className="dot" />{t('graph.connected')}</span>
            : s.enabled ? <span className="pill err"><span className="dot" />{t('graph.disconnected')}</span>
            : <span className="pill"><span className="dot" />{t('graph.notConfigured')}</span>}
          {s?.version && <span className="muted small ltr">{s.version} · {s.uri}</span>}
          <span className="spacer" />
          <button className="btn sm ghost" id="gRefresh" onClick={() => void loadStatus()}><Icon name="refresh" />{t('graph.refresh')}</button>
          <button className="btn sm" id="gSyncAll" disabled={!s?.connected || syncing} onClick={syncAll}>
            {syncing ? <><Spinner />{t('graph.syncing')}</> : <><Icon name="refresh" />{t('graph.syncAll')}</>}
          </button>
          <button className="btn sm ghost" id="gSetupToggle" onClick={() => setSetupOpen(!showSetup)}><Icon name="settings" />{t('graph.setup')}</button>
        </div>
        {s?.error && <p className="small" style={{ color: 'var(--err)', marginTop: 0 }}>{s.error}</p>}
        {counts.length > 0 ? (
          <div className="chips">
            {counts.map(([label, n]) => (
              <button key={label} className="chip gcount" data-label={label} onClick={() => {
                const q = `MATCH (n:\`${label}\`)\nOPTIONAL MATCH (n)-[r]-(m)\nRETURN n, r, m LIMIT 150`;
                setCypher(q);
                void run(q);
              }}>
                <span className="gnode" style={{ '--c': labelColor(label) } as React.CSSProperties}>{label}</span> {fmtNumber(n)}
              </button>
            ))}
          </div>
        ) : s?.connected ? <p className="muted small" style={{ margin: 0 }}>{t('graph.emptyDb')}</p> : null}
        {showSetup && s && <GraphSetup status={s} onSaved={next => { setStatus(next); setSetupOpen(null); }} />}
      </div>

      <div className="graph-grid">
        <div className="stack" style={{ minWidth: 0 }}>
          <div className="card">
            <div className="card-head" style={{ flexWrap: 'wrap' }}>
              <Icon name="code" /><h3>{t('graph.console')}</h3><span className="spacer" />
              <span className="muted small">{t('graph.readOnly')}</span>
            </div>
            <div className="chips" id="gExamples" style={{ marginBottom: 10 }}>
              {EXAMPLES.map((x, i) => (
                <button key={x.key} className="chip" data-ex={i} onClick={() => { setCypher(x.cypher); void run(x.cypher); }}>{t(x.key)}</button>
              ))}
            </div>
            <textarea className="input textarea ltr mono" id="gCypher" rows={5} spellCheck={false} value={cypher} onChange={e => setCypher(e.target.value)}
              onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run(); } }} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" id="gRun" onClick={() => void run()}><Icon name="play" />{t('graph.run')}</button>
              <span className="muted small">Ctrl + Enter</span>
              <span className="spacer" />
              <button className="btn sm ghost" id="gAskQuery" onClick={() => askAssistant(t('graph.askAbout.prompt', { query: cypher.trim() }), router.push)}>
                <Icon name="zap" />{t('graph.askAbout')}
              </button>
            </div>
          </div>
          <div className="card" id="gResult">
            {result.kind === 'idle' && <Empty icon="network"><p>{t('graph.result.empty')}</p></Empty>}
            {result.kind === 'loading' && <div className="empty"><Spinner /></div>}
            {result.kind === 'error' && <div className="ai-msg error"><Icon name="alert" /><span className="ltr">{result.message}</span></div>}
            {result.kind === 'ok' && (
              <QueryResultView key={result.seq} graph result={result.result} title={result.title}
                onExplain={() => askAssistant(t('graph.explain.prompt', { query: lastQuery, rows: JSON.stringify(result.result.rows.slice(0, 30)).slice(0, 6000) }), router.push)} />
            )}
          </div>
        </div>
        <div className="stack">
          <form className="card" onSubmit={(e: FormEvent) => { e.preventDefault(); sendAsk(); }}>
            <div className="card-head"><Icon name="zap" /><h3>{t('graph.ask')}</h3></div>
            <p className="muted small" style={{ marginTop: 0 }}>{t('graph.ask.hint')}</p>
            <textarea className="input textarea" id="gAsk" rows={3} placeholder={t('graph.ask.placeholder')} value={ask} onChange={e => setAsk(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendAsk(); } }} />
            <div className="row" style={{ marginTop: 10 }}><span className="spacer" /><button className="btn primary" id="gAskBtn" type="submit"><Icon name="zap" />{t('graph.ask.send')}</button></div>
          </form>
          <div className="card">
            <div className="card-head"><Icon name="search" /><h3>{t('graph.insights')}</h3></div>
            <ul className="list-plain insight-list" id="gInsights">
              {!s?.connected ? <li className="muted small">{t('graph.insights.needDb')}</li>
                : !insights ? <li className="muted small">…</li>
                : insights.map(i => (
                  <li key={i.id}>
                    <button className={`insight-btn ${activeInsight === i.id ? 'active' : ''}`} data-id={i.id} onClick={() => runInsight(i)}>
                      <strong>{tOr(`graph.insight.${i.id}`, i.title)}</strong>
                      <span className="muted small">{tOr(`graph.insight.${i.id}.d`, i.description)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function GraphSetup({ status: s, onSaved }: { status: GraphStatus; onSaved: (s: GraphStatus) => void }) {
  const fromEnv = s.source === 'env';
  const [form, setForm] = useState({ uri: s.uri || 'bolt://localhost:7687', user: s.user || 'neo4j', password: '', database: s.database || '', enabled: s.enabled, autoSync: s.autoSync ?? true });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const next = await api.graphConfig(form);
      toast(next.connected ? t('graph.connected') : next.error || t('graph.disconnected'), next.connected ? 'ok' : 'err');
      onSaved(next);
    } catch (err) {
      toast(errMsg(err), 'err');
    }
  };
  return (
    <form className="stack" id="gSetup" style={{ marginTop: 14 }} onSubmit={submit}>
      {fromEnv && <p className="hint" style={{ margin: 0 }}>{t('graph.envNote')}</p>}
      <p className="muted small" style={{ margin: 0 }}>{t('graph.setup.hint')}</p>
      <pre className="code ltr" style={{ margin: 0 }}>docker compose up -d neo4j</pre>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        <div className="field"><label htmlFor="gUri">URI</label><input className="input ltr" id="gUri" value={form.uri} onChange={e => setForm({ ...form, uri: e.target.value })} spellCheck={false} disabled={fromEnv} /></div>
        <div className="field"><label htmlFor="gUser">{t('graph.user')}</label><input className="input ltr" id="gUser" value={form.user} onChange={e => setForm({ ...form, user: e.target.value })} spellCheck={false} disabled={fromEnv} /></div>
        <div className="field"><label htmlFor="gPass">{t('graph.password')}</label><input className="input ltr" id="gPass" type="password" autoComplete="off" value={form.password} placeholder={s.hasPassword ? t('graph.password.keep') : ''} onChange={e => setForm({ ...form, password: e.target.value })} disabled={fromEnv} /></div>
        <div className="field"><label htmlFor="gDb">{t('graph.database')}</label><input className="input ltr" id="gDb" value={form.database} placeholder="neo4j" onChange={e => setForm({ ...form, database: e.target.value })} spellCheck={false} disabled={fromEnv} /></div>
      </div>
      <div className="row">
        <label className="row" style={{ cursor: 'pointer' }}><Switch id="gEnabled" checked={form.enabled} disabled={fromEnv} onChange={v => setForm({ ...form, enabled: v })} />{t('graph.enabled')}</label>
        <label className="row" style={{ cursor: 'pointer' }}><Switch id="gAuto" checked={form.autoSync} disabled={fromEnv} onChange={v => setForm({ ...form, autoSync: v })} />{t('graph.autoSync')}</label>
        <span className="spacer" />
        <button className="btn primary" type="submit" disabled={fromEnv}><Icon name="check" />{t('graph.saveConnect')}</button>
      </div>
    </form>
  );
}
