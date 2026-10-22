'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { QueryResultView } from '@/components/QueryResult';
import { Empty, Spinner, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg, fmtBytes } from '@/lib/format';
import { fmtDate, fmtNumber, t } from '@/lib/i18n';
import type { ArchivedSession, QueryResult, StorageStatus } from '@/lib/types';
import { askAssistant, toast, useHeader } from '@/lib/ui';

const EXAMPLES: { key: string; sql: string }[] = [
  { key: 'storage.ex.sessions', sql: 'SELECT id, url, status, started_at, requests, errors, file_count, total_bytes\nFROM sessions\nORDER BY started_at DESC\nLIMIT 50' },
  { key: 'storage.ex.hosts', sql: 'SELECT host, count(*) AS requests, sum(size) AS bytes,\n       count(*) FILTER (WHERE status >= 400 OR failure IS NOT NULL) AS failed\nFROM requests\nGROUP BY host\nORDER BY requests DESC' },
  { key: 'storage.ex.records', sql: "SELECT s.name AS scrape, r.idx, r.data\nFROM scrape_records r\nJOIN scrapes s ON s.id = r.scrape_id\nORDER BY s.scraped_at DESC, r.idx\nLIMIT 200" },
  { key: 'storage.ex.errors', sql: "SELECT session_id, type, left(text, 200) AS text, source\nFROM console_messages\nWHERE type IN ('error', 'uncaught')\nORDER BY at DESC\nLIMIT 100" },
  { key: 'storage.ex.headers', sql: 'SELECT name, count(*) FILTER (WHERE NOT present) AS missing, count(*) AS sessions\nFROM security_headers\nGROUP BY name\nORDER BY missing DESC' }
];

type ConfigBody = Parameters<typeof api.storageConfig>[0];
type ResultState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; result: QueryResult; seq: number };

function StatePill({ known, enabled, connected }: { known: boolean; enabled: boolean; connected: boolean }) {
  if (!known) return <span className="pill"><Spinner /></span>;
  if (connected) return <span className="pill ok"><span className="dot" />{t('graph.connected')}</span>;
  if (enabled) return <span className="pill err"><span className="dot" />{t('graph.disconnected')}</span>;
  return <span className="pill"><span className="dot" />{t('graph.notConfigured')}</span>;
}

export function StorageView() {
  useHeader(t('storage.title'), t('storage.subtitle'));
  const router = useRouter();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [list, setList] = useState<ArchivedSession[] | null>(null);
  const [listError, setListError] = useState('');
  const [busyAll, setBusyAll] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [sql, setSql] = useState(EXAMPLES[0].sql);
  const [lastSql, setLastSql] = useState(EXAMPLES[0].sql);
  const [result, setResult] = useState<ResultState>({ kind: 'idle' });
  const [schema, setSchema] = useState('…');
  const [ask, setAsk] = useState('');
  const [forms, setForms] = useState<{ pg: boolean | null; s3: boolean | null }>({ pg: null, s3: null });

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.storageStatus();
      setStatus(s);
      return s;
    } catch (e) {
      toast(errMsg(e), 'err');
      return null;
    }
  }, []);

  const loadList = useCallback(async (s: StorageStatus | null) => {
    if (!s?.postgres.connected && !s?.s3.connected) { setList(null); return; }
    try {
      setList(await api.archivedSessions());
      setListError('');
    } catch (e) {
      setListError(errMsg(e));
    }
  }, []);

  const reload = useCallback(async () => { await loadList(await loadStatus()); }, [loadStatus, loadList]);

  useEffect(() => {
    void reload();
    api.storageSchema().then(s => setSchema(s.schema)).catch(() => undefined);
  }, [reload]);

  const save = async (patch: ConfigBody) => {
    try {
      const s = await api.storageConfig(patch);
      setStatus(s);
      const ok = (patch.postgres ? s.postgres.connected : true) && (patch.s3 ? s.s3.connected : true);
      toast(ok ? t('graph.connected') : (patch.postgres ? s.postgres.error : s.s3.error) || t('graph.disconnected'), ok ? 'ok' : 'err');
      if (patch.postgres || patch.s3) setForms({ pg: null, s3: null });
      void loadList(s);
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const archiveAll = async () => {
    setBusyAll(true);
    try {
      const r = await api.archiveAll();
      toast(t('storage.archivedN', { n: r.archived.length }), r.failed.length ? 'info' : 'ok');
      if (r.failed.length) toast(r.failed.map(f => `${f.sessionId}: ${f.error}`).join('\n'), 'err', 6000);
    } catch (e) {
      toast(errMsg(e), 'err');
    }
    setBusyAll(false);
    await reload();
  };

  const rowAction = async (id: string, kind: 'restore' | 'prune' | 'forget') => {
    if (kind === 'prune' && !confirm(t('storage.prune.confirm'))) return;
    if (kind === 'forget' && !confirm(t('storage.forget.confirm'))) return;
    setBusyRow(`${kind}:${id}`);
    try {
      if (kind === 'restore') {
        const r = await api.restoreSession(id);
        toast(t('storage.restored', { n: fmtNumber(r.files) }), 'ok');
      } else if (kind === 'prune') {
        await api.archiveSession(id, true);
        toast(t('storage.pruned'), 'ok');
      } else {
        await api.forgetArchived(id);
        toast(t('storage.forgotten'), 'ok');
      }
      await reload();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
    setBusyRow(null);
  };

  const run = async (q = sql) => {
    const text = q.trim();
    if (!text) return;
    setLastSql(text);
    setResult({ kind: 'loading' });
    try {
      setResult({ kind: 'ok', result: await api.storageSql(text), seq: Date.now() });
    } catch (e) {
      setResult({ kind: 'error', message: errMsg(e) });
    }
  };

  const sendAsk = () => {
    const q = ask.trim();
    if (q) askAssistant(t('storage.ask.prefix') + q, router.push);
  };

  const pg = status?.postgres;
  const s3 = status?.s3;
  const anyConnected = !!pg?.connected || !!s3?.connected;
  const pgFormOpen = forms.pg ?? (!!status && !pg?.connected);
  const s3FormOpen = forms.s3 ?? (!!status && !s3?.connected);

  return (
    <div className="stack">
      <div className="grid storage-cards" id="stCards">
        <div className="card">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <Icon name="database" /><h3>PostgreSQL</h3><StatePill known={!!status} enabled={!!pg?.enabled} connected={!!pg?.connected} />
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => setForms({ ...forms, pg: !pgFormOpen })}><Icon name="settings" />{t('graph.setup')}</button>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>{t('storage.pg.hint')}</p>
          {pg?.version && <div className="muted small ltr" style={{ marginBottom: 8 }}>{pg.version} · {pg.url}</div>}
          {pg?.error && <p className="small" style={{ color: 'var(--err)' }}>{pg.error}</p>}
          {pg?.counts && <div className="chips">{Object.entries(pg.counts).map(([k, n]) => <span key={k} className="chip">{k} <strong>{fmtNumber(n)}</strong></span>)}</div>}
          {pgFormOpen && status && <PostgresForm status={status} onSave={save} />}
        </div>
        <div className="card">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <Icon name="server" /><h3>SeaweedFS</h3><StatePill known={!!status} enabled={!!s3?.enabled} connected={!!s3?.connected} />
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => setForms({ ...forms, s3: !s3FormOpen })}><Icon name="settings" />{t('graph.setup')}</button>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>{t('storage.s3.hint')}</p>
          {s3?.connected && (
            <>
              <div className="muted small ltr" style={{ marginBottom: 8 }}>{s3.endpoint} · bucket {s3.bucket}</div>
              <div className="chips">
                <span className="chip">{t('storage.sessions')} <strong>{fmtNumber(s3.sessions)}</strong></span>
                <span className="chip">{t('storage.objects')} <strong>{fmtNumber(s3.objects)}</strong></span>
                <span className="chip">{fmtBytes(s3.bytes)}</span>
              </div>
            </>
          )}
          {s3?.error && <p className="small" style={{ color: 'var(--err)' }}>{s3.error}</p>}
          {s3FormOpen && status && <S3Form status={status} onSave={save} />}
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <Icon name="archive" /><h3>{t('storage.archived')}</h3>
          <span className="spacer" />
          <label className="row small" style={{ cursor: 'pointer' }}>
            <Switch id="stAuto" checked={status?.autoArchive ?? true} onChange={v => void save({ autoArchive: v })} />{t('storage.autoArchive')}
          </label>
          <button className="btn sm ghost" id="stReload" onClick={() => void reload()}><Icon name="refresh" />{t('graph.refresh')}</button>
          <button className="btn sm" id="stArchiveAll" disabled={!anyConnected || busyAll} onClick={archiveAll}>
            {busyAll ? <><Spinner />{t('storage.archiving')}</> : <><Icon name="upload" />{t('storage.archiveAll')}</>}
          </button>
        </div>
        <div id="stList">
          {!status ? <div className="empty"><Spinner /></div>
            : !anyConnected ? (
              <div className="empty">
                <p>{t('storage.notConfigured')}</p>
                <pre className="code ltr" style={{ display: 'inline-block', textAlign: 'start' }}>docker compose up -d postgres seaweedfs</pre>
              </div>
            )
            : listError ? <div className="ai-msg error"><Icon name="alert" /><span>{listError}</span></div>
            : !list ? <div className="empty"><Spinner /></div>
            : !list.length ? <Empty>{t('storage.empty')}</Empty>
            : (
              <div className="table-wrap" style={{ maxHeight: 460 }}>
                <table className="table">
                  <thead><tr><th>{t('storage.col.session')}</th><th>{t('sessions.started')}</th><th>{t('stat.requests')}</th><th>{t('storage.col.files')}</th><th>{t('storage.col.where')}</th><th></th></tr></thead>
                  <tbody>
                    {list.map(s => (
                      <tr key={s.id}>
                        <td><div className="ltr truncate" style={{ maxWidth: 420 }}>{s.url || s.id}</div><div className="muted small ltr">{s.id}</div></td>
                        <td className="small">{fmtDate(s.startedAt)}</td>
                        <td>{fmtNumber(s.requests)}</td>
                        <td className="small">{fmtNumber(s.files)} · {fmtBytes(s.bytes)}</td>
                        <td>
                          <div className="pills" style={{ margin: 0 }}>
                            {s.local && <span className="pill ok">{t('storage.local')}</span>}
                            {s.inObjectStore && <span className="pill info">SeaweedFS</span>}
                            {pg?.connected && <span className="pill accent">PostgreSQL</span>}
                          </div>
                        </td>
                        <td>
                          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            {s.local && <Link className="btn sm ghost" href={`/sessions/?id=${encodeURIComponent(s.id)}`}><Icon name="eye" />{t('storage.open')}</Link>}
                            {!s.local && s.inObjectStore && (
                              <button className="btn sm" data-restore={s.id} disabled={busyRow !== null} onClick={() => rowAction(s.id, 'restore')}><Icon name="download" />{t('storage.restore')}</button>
                            )}
                            {s.local && s.inObjectStore && (
                              <button className="btn sm ghost" data-prune={s.id} disabled={busyRow !== null} title={t('storage.prune.hint')} onClick={() => rowAction(s.id, 'prune')}><Icon name="trash" />{t('storage.prune')}</button>
                            )}
                            <button className="btn sm danger ghost" data-forget={s.id} disabled={busyRow !== null} title={t('storage.forget.hint')} onClick={() => rowAction(s.id, 'forget')}><Icon name="x" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>

      <div className="graph-grid">
        <div className="stack" style={{ minWidth: 0 }}>
          <div className="card">
            <div className="card-head" style={{ flexWrap: 'wrap' }}>
              <Icon name="database" /><h3>{t('storage.sql')}</h3><span className="spacer" />
              <span className="muted small">{t('graph.readOnly')} · PostgreSQL</span>
            </div>
            <div className="chips" id="stExamples" style={{ marginBottom: 10 }}>
              {EXAMPLES.map((x, i) => <button key={x.key} className="chip" data-ex={i} onClick={() => { setSql(x.sql); void run(x.sql); }}>{t(x.key)}</button>)}
            </div>
            <textarea className="input textarea ltr mono" id="stSql" rows={6} spellCheck={false} value={sql} onChange={e => setSql(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run(); } }} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" id="stRun" onClick={() => void run()}><Icon name="play" />{t('graph.run')}</button>
              <span className="muted small">Ctrl + Enter</span>
            </div>
          </div>
          <div className="card" id="stResult">
            {result.kind === 'idle' && <Empty icon="database"><p>{t('storage.result.empty')}</p></Empty>}
            {result.kind === 'loading' && <div className="empty"><Spinner /></div>}
            {result.kind === 'error' && <div className="ai-msg error"><Icon name="alert" /><span className="ltr">{result.message}</span></div>}
            {result.kind === 'ok' && (
              <QueryResultView key={result.seq} result={result.result}
                onExplain={() => askAssistant(t('storage.explain.prompt', { query: lastSql, rows: JSON.stringify(result.result.rows.slice(0, 30)).slice(0, 6000) }), router.push)} />
            )}
          </div>
        </div>
        <div className="stack">
          <form className="card" onSubmit={(e: FormEvent) => { e.preventDefault(); sendAsk(); }}>
            <div className="card-head"><Icon name="zap" /><h3>{t('graph.ask')}</h3></div>
            <p className="muted small" style={{ marginTop: 0 }}>{t('storage.ask.hint')}</p>
            <textarea className="input textarea" id="stAsk" rows={3} style={{ fontFamily: 'var(--font)', fontSize: 14 }} placeholder={t('storage.ask.placeholder')} value={ask}
              onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendAsk(); } }} />
            <div className="row" style={{ marginTop: 10 }}><span className="spacer" /><button className="btn primary" id="stAskBtn" type="submit"><Icon name="zap" />{t('graph.ask.send')}</button></div>
          </form>
          <div className="card">
            <div className="card-head"><Icon name="code" /><h3>{t('storage.schema')}</h3></div>
            <pre className="code ltr" id="stSchema" style={{ maxHeight: 420, overflow: 'auto', fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{schema}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostgresForm({ status, onSave }: { status: StorageStatus; onSave: (p: ConfigBody) => Promise<void> }) {
  const pg = status.postgres;
  const fromEnv = pg.source === 'env';
  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(pg.enabled);
  return (
    <form className="stack" id="pgForm" style={{ marginTop: 14 }} onSubmit={e => { e.preventDefault(); void onSave({ postgres: { enabled, url } }); }}>
      {fromEnv && <p className="hint" style={{ margin: 0 }}>{t('storage.envNote')}</p>}
      <div className="field">
        <label htmlFor="pgUrl">{t('storage.pg.url')}</label>
        <input className="input ltr" id="pgUrl" type="password" autoComplete="off" spellCheck={false} disabled={fromEnv} value={url} onChange={e => setUrl(e.target.value)}
          placeholder={pg.url ? t('storage.keep') : 'postgres://extractor:password@localhost:5432/extractor'} />
      </div>
      <div className="row">
        <label className="row" style={{ cursor: 'pointer' }}><Switch id="pgEnabled" checked={enabled} disabled={fromEnv} onChange={setEnabled} />{t('graph.enabled')}</label>
        <span className="spacer" />
        <button className="btn primary" type="submit" disabled={fromEnv}><Icon name="check" />{t('graph.saveConnect')}</button>
      </div>
    </form>
  );
}

function S3Form({ status, onSave }: { status: StorageStatus; onSave: (p: ConfigBody) => Promise<void> }) {
  const s3 = status.s3;
  const fromEnv = s3.source === 'env';
  const [form, setForm] = useState({ endpoint: s3.endpoint || 'http://localhost:8333', bucket: s3.bucket || 'extractor', accessKeyId: s3.accessKeyId || '', secretAccessKey: '', enabled: s3.enabled });
  const field = (id: string, key: keyof typeof form, label: string, extra: Record<string, string> = {}) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input className="input ltr" id={id} spellCheck={false} disabled={fromEnv} value={String(form[key])} onChange={e => setForm({ ...form, [key]: e.target.value })} {...extra} />
    </div>
  );
  return (
    <form className="stack" id="s3Form" style={{ marginTop: 14 }} onSubmit={e => { e.preventDefault(); void onSave({ s3: form }); }}>
      {fromEnv && <p className="hint" style={{ margin: 0 }}>{t('storage.envNote')}</p>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        {field('s3Endpoint', 'endpoint', t('storage.s3.endpoint'))}
        {field('s3Bucket', 'bucket', 'Bucket')}
        {field('s3Key', 'accessKeyId', 'Access key')}
        {field('s3Secret', 'secretAccessKey', 'Secret key', { type: 'password', autoComplete: 'off', placeholder: s3.hasSecret ? t('storage.keep') : '' })}
      </div>
      <div className="row">
        <label className="row" style={{ cursor: 'pointer' }}><Switch id="s3Enabled" checked={form.enabled} disabled={fromEnv} onChange={v => setForm({ ...form, enabled: v })} />{t('graph.enabled')}</label>
        <span className="spacer" />
        <button className="btn primary" type="submit" disabled={fromEnv}><Icon name="check" />{t('graph.saveConnect')}</button>
      </div>
    </form>
  );
}
