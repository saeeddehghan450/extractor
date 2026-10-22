import { api, ArchivedSession, StorageStatus, SqlResult } from '../api.js';
import { icon } from '../icons.js';
import { fmtDate, fmtNumber, t } from '../i18n.js';
import { $, errMsg, esc, fmtBytes, html, toast } from '../util.js';
import type { ViewContext } from '../types.js';
import { askAssistant } from './graph.js';

const EXAMPLES: { key: string; sql: string }[] = [
  { key: 'storage.ex.sessions', sql: 'SELECT id, url, status, started_at, requests, errors, file_count, total_bytes\nFROM sessions\nORDER BY started_at DESC\nLIMIT 50' },
  { key: 'storage.ex.hosts', sql: 'SELECT host, count(*) AS requests, sum(size) AS bytes,\n       count(*) FILTER (WHERE status >= 400 OR failure IS NOT NULL) AS failed\nFROM requests\nGROUP BY host\nORDER BY requests DESC' },
  { key: 'storage.ex.records', sql: "SELECT s.name AS scrape, r.idx, r.data\nFROM scrape_records r\nJOIN scrapes s ON s.id = r.scrape_id\nORDER BY s.scraped_at DESC, r.idx\nLIMIT 200" },
  { key: 'storage.ex.errors', sql: "SELECT session_id, type, left(text, 200) AS text, source\nFROM console_messages\nWHERE type IN ('error', 'uncaught')\nORDER BY at DESC\nLIMIT 100" },
  { key: 'storage.ex.headers', sql: 'SELECT name, count(*) FILTER (WHERE NOT present) AS missing, count(*) AS sessions\nFROM security_headers\nGROUP BY name\nORDER BY missing DESC' }
];

function sqlCell(v: unknown): string {
  if (v == null) return '<span class="muted">null</span>';
  if (typeof v === 'object') return `<code class="ltr">${esc(JSON.stringify(v).slice(0, 400))}</code>`;
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return `<span class="ltr">${esc(String(v).slice(0, 400))}</span>`;
}

export function mount(el: HTMLElement, _params: string[], { setHeader }: ViewContext): void {
  setHeader(t('storage.title'), t('storage.subtitle'));
  let status: StorageStatus | null = null;
  let lastSql = EXAMPLES[0].sql;
  let result: SqlResult | null = null;

  html(el, `
    <div class="stack">
      <div class="grid storage-cards" id="stCards"></div>
      <div class="card">
        <div class="card-head" style="flex-wrap:wrap">${icon('archive')}<h3>${esc(t('storage.archived'))}</h3>
          <span class="spacer"></span>
          <label class="row small" style="cursor:pointer"><span class="switch"><input type="checkbox" id="stAuto"><span></span></span>${esc(t('storage.autoArchive'))}</label>
          <button class="btn sm ghost" id="stReload">${icon('refresh')}${esc(t('graph.refresh'))}</button>
          <button class="btn sm" id="stArchiveAll">${icon('upload')}${esc(t('storage.archiveAll'))}</button>
        </div>
        <div id="stList"><div class="empty"><span class="spinner"></span></div></div>
      </div>
      <div class="graph-grid">
        <div class="stack" style="min-width:0">
          <div class="card">
            <div class="card-head" style="flex-wrap:wrap">${icon('database')}<h3>${esc(t('storage.sql'))}</h3><span class="spacer"></span>
              <span class="muted small">${esc(t('graph.readOnly'))} · PostgreSQL</span></div>
            <div class="chips" id="stExamples" style="margin-bottom:10px">${EXAMPLES.map((x, i) => `<button class="chip" data-ex="${i}">${esc(t(x.key))}</button>`).join('')}</div>
            <textarea class="input textarea ltr mono" id="stSql" rows="6" spellcheck="false">${esc(lastSql)}</textarea>
            <div class="row" style="margin-top:10px">
              <button class="btn primary" id="stRun">${icon('play')}${esc(t('graph.run'))}</button>
              <span class="muted small">Ctrl + Enter</span>
            </div>
          </div>
          <div class="card" id="stResult"><div class="empty">${icon('database')}<p>${esc(t('storage.result.empty'))}</p></div></div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head">${icon('zap')}<h3>${esc(t('graph.ask'))}</h3></div>
            <p class="muted small" style="margin-top:0">${esc(t('storage.ask.hint'))}</p>
            <textarea class="input textarea" id="stAsk" rows="3" style="font-family:var(--font);font-size:14px" placeholder="${esc(t('storage.ask.placeholder'))}"></textarea>
            <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn primary" id="stAskBtn">${icon('zap')}${esc(t('graph.ask.send'))}</button></div>
          </div>
          <div class="card">
            <div class="card-head">${icon('code')}<h3>${esc(t('storage.schema'))}</h3></div>
            <pre class="code ltr" id="stSchema" style="max-height:420px;overflow:auto;font-size:11.5px;white-space:pre-wrap">…</pre>
          </div>
        </div>
      </div>
    </div>`);

  // ------------------------------------------------------------ status cards
  const renderCards = () => {
    const box = $('#stCards', el);
    const s = status;
    const pill = (enabled: boolean, connected: boolean) => !s ? '<span class="pill"><span class="spinner"></span></span>'
      : connected ? `<span class="pill ok"><span class="dot"></span>${esc(t('graph.connected'))}</span>`
      : enabled ? `<span class="pill err"><span class="dot"></span>${esc(t('graph.disconnected'))}</span>`
      : `<span class="pill"><span class="dot"></span>${esc(t('graph.notConfigured'))}</span>`;
    const pg = s?.postgres;
    const s3 = s?.s3;
    const pgEnv = pg?.source === 'env';
    const s3Env = s3?.source === 'env';
    html(box, `
      <div class="card">
        <div class="card-head" style="flex-wrap:wrap">${icon('database')}<h3>PostgreSQL</h3>${pill(!!pg?.enabled, !!pg?.connected)}
          <span class="spacer"></span><button class="btn sm ghost" data-toggle="pgForm">${icon('settings')}${esc(t('graph.setup'))}</button></div>
        <p class="muted small" style="margin-top:0">${esc(t('storage.pg.hint'))}</p>
        ${pg?.version ? `<div class="muted small ltr" style="margin-bottom:8px">${esc(pg.version)} · ${esc(pg.url)}</div>` : ''}
        ${pg?.error ? `<p class="small" style="color:var(--err)">${esc(pg.error)}</p>` : ''}
        ${pg?.counts ? `<div class="chips">${Object.entries(pg.counts).map(([k, n]) => `<span class="chip">${esc(k)} <strong>${fmtNumber(n)}</strong></span>`).join('')}</div>` : ''}
        <form class="stack" id="pgForm" style="margin-top:14px;${s && !pg?.connected ? '' : 'display:none'}">
          ${pgEnv ? `<p class="hint" style="margin:0">${esc(t('storage.envNote'))}</p>` : ''}
          <div class="field"><label for="pgUrl">${esc(t('storage.pg.url'))}</label>
            <input class="input ltr" id="pgUrl" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(pg?.url && pg.url !== '' ? t('storage.keep') : 'postgres://extractor:password@localhost:5432/extractor')}" ${pgEnv ? 'disabled' : ''}></div>
          <div class="row">
            <label class="row" style="cursor:pointer"><span class="switch"><input type="checkbox" id="pgEnabled" ${pg?.enabled ? 'checked' : ''} ${pgEnv ? 'disabled' : ''}><span></span></span>${esc(t('graph.enabled'))}</label>
            <span class="spacer"></span><button class="btn primary" type="submit" ${pgEnv ? 'disabled' : ''}>${icon('check')}${esc(t('graph.saveConnect'))}</button>
          </div>
        </form>
      </div>
      <div class="card">
        <div class="card-head" style="flex-wrap:wrap">${icon('server')}<h3>SeaweedFS</h3>${pill(!!s3?.enabled, !!s3?.connected)}
          <span class="spacer"></span><button class="btn sm ghost" data-toggle="s3Form">${icon('settings')}${esc(t('graph.setup'))}</button></div>
        <p class="muted small" style="margin-top:0">${esc(t('storage.s3.hint'))}</p>
        ${s3?.connected ? `<div class="muted small ltr" style="margin-bottom:8px">${esc(s3.endpoint)} · bucket ${esc(s3.bucket)}</div>
          <div class="chips"><span class="chip">${esc(t('storage.sessions'))} <strong>${fmtNumber(s3.sessions)}</strong></span>
            <span class="chip">${esc(t('storage.objects'))} <strong>${fmtNumber(s3.objects)}</strong></span>
            <span class="chip">${fmtBytes(s3.bytes)}</span></div>` : ''}
        ${s3?.error ? `<p class="small" style="color:var(--err)">${esc(s3.error)}</p>` : ''}
        <form class="stack" id="s3Form" style="margin-top:14px;${s && !s3?.connected ? '' : 'display:none'}">
          ${s3Env ? `<p class="hint" style="margin:0">${esc(t('storage.envNote'))}</p>` : ''}
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
            <div class="field"><label for="s3Endpoint">${esc(t('storage.s3.endpoint'))}</label><input class="input ltr" id="s3Endpoint" value="${esc(s3?.endpoint || 'http://localhost:8333')}" spellcheck="false" ${s3Env ? 'disabled' : ''}></div>
            <div class="field"><label for="s3Bucket">Bucket</label><input class="input ltr" id="s3Bucket" value="${esc(s3?.bucket || 'extractor')}" spellcheck="false" ${s3Env ? 'disabled' : ''}></div>
            <div class="field"><label for="s3Key">Access key</label><input class="input ltr" id="s3Key" value="${esc(s3?.accessKeyId || '')}" spellcheck="false" ${s3Env ? 'disabled' : ''}></div>
            <div class="field"><label for="s3Secret">Secret key</label><input class="input ltr" id="s3Secret" type="password" autocomplete="off" placeholder="${esc(s3?.hasSecret ? t('storage.keep') : '')}" ${s3Env ? 'disabled' : ''}></div>
          </div>
          <div class="row">
            <label class="row" style="cursor:pointer"><span class="switch"><input type="checkbox" id="s3Enabled" ${s3?.enabled ? 'checked' : ''} ${s3Env ? 'disabled' : ''}><span></span></span>${esc(t('graph.enabled'))}</label>
            <span class="spacer"></span><button class="btn primary" type="submit" ${s3Env ? 'disabled' : ''}>${icon('check')}${esc(t('graph.saveConnect'))}</button>
          </div>
        </form>
      </div>`);

    box.querySelectorAll<HTMLElement>('[data-toggle]').forEach(b => {
      b.onclick = () => { const f = $(`#${b.dataset.toggle}`, box); f.style.display = f.style.display === 'none' ? '' : 'none'; };
    });
    const save = async (patch: Parameters<typeof api.storageConfig>[0]) => {
      try {
        status = await api.storageConfig(patch);
        const ok = (patch.postgres ? status.postgres.connected : true) && (patch.s3 ? status.s3.connected : true);
        toast(ok ? t('graph.connected') : (patch.postgres ? status.postgres.error : status.s3.error) || t('graph.disconnected'), ok ? 'ok' : 'err');
        renderAll();
        void loadList();
      } catch (e) {
        toast(errMsg(e), 'err');
      }
    };
    $<HTMLFormElement>('#pgForm', box).onsubmit = e => {
      e.preventDefault();
      void save({ postgres: { enabled: $<HTMLInputElement>('#pgEnabled', box).checked, url: $<HTMLInputElement>('#pgUrl', box).value } });
    };
    $<HTMLFormElement>('#s3Form', box).onsubmit = e => {
      e.preventDefault();
      const v = (id: string) => $<HTMLInputElement>(id, box).value;
      void save({ s3: { enabled: $<HTMLInputElement>('#s3Enabled', box).checked, endpoint: v('#s3Endpoint'), bucket: v('#s3Bucket'), accessKeyId: v('#s3Key'), secretAccessKey: v('#s3Secret') } });
    };
  };

  const renderAll = () => {
    renderCards();
    const auto = $<HTMLInputElement>('#stAuto', el);
    auto.checked = status?.autoArchive ?? true;
    $<HTMLButtonElement>('#stArchiveAll', el).disabled = !(status?.postgres.connected || status?.s3.connected);
  };

  const loadStatus = async () => {
    try {
      status = await api.storageStatus();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
    if (el.isConnected) renderAll();
  };

  // ------------------------------------------------------------ archived sessions
  const loadList = async () => {
    const box = $('#stList', el);
    if (!status?.postgres.connected && !status?.s3.connected) {
      html(box, `<div class="empty"><p>${esc(t('storage.notConfigured'))}</p><pre class="code ltr" style="display:inline-block;text-align:start">docker compose up -d postgres seaweedfs</pre></div>`);
      return;
    }
    let list: ArchivedSession[];
    try {
      list = await api.archivedSessions();
    } catch (e) {
      html(box, `<div class="ai-msg error">${icon('alert')}<span>${esc(errMsg(e))}</span></div>`);
      return;
    }
    if (!list.length) {
      html(box, `<div class="empty"><p>${esc(t('storage.empty'))}</p></div>`);
      return;
    }
    html(box, `<div class="table-wrap" style="max-height:460px"><table class="table">
      <thead><tr><th>${esc(t('storage.col.session'))}</th><th>${esc(t('sessions.started'))}</th><th>${esc(t('stat.requests'))}</th>
        <th>${esc(t('storage.col.files'))}</th><th>${esc(t('storage.col.where'))}</th><th></th></tr></thead>
      <tbody>${list.map(s => `<tr>
        <td><div class="ltr truncate" style="max-width:420px">${esc(s.url || s.id)}</div><div class="muted small ltr">${esc(s.id)}</div></td>
        <td class="small">${esc(fmtDate(s.startedAt))}</td>
        <td>${fmtNumber(s.requests)}</td>
        <td class="small">${fmtNumber(s.files)} · ${fmtBytes(s.bytes)}</td>
        <td><div class="pills" style="margin:0">${s.local ? `<span class="pill ok">${esc(t('storage.local'))}</span>` : ''}${s.inObjectStore ? '<span class="pill info">SeaweedFS</span>' : ''}<span class="pill accent">PostgreSQL</span></div></td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap">
          ${s.local ? `<a class="btn sm ghost" href="#/sessions/${encodeURIComponent(s.id)}">${icon('eye')}${esc(t('storage.open'))}</a>` : ''}
          ${!s.local && s.inObjectStore ? `<button class="btn sm" data-restore="${esc(s.id)}">${icon('download')}${esc(t('storage.restore'))}</button>` : ''}
          ${s.local && s.inObjectStore ? `<button class="btn sm ghost" data-prune="${esc(s.id)}" title="${esc(t('storage.prune.hint'))}">${icon('trash')}${esc(t('storage.prune'))}</button>` : ''}
          <button class="btn sm danger ghost" data-forget="${esc(s.id)}" title="${esc(t('storage.forget.hint'))}">${icon('x')}</button>
        </div></td></tr>`).join('')}</tbody></table></div>`);
    // rows without PostgreSQL info only come from SeaweedFS
    if (!status?.postgres.connected) box.querySelectorAll('.pill.accent').forEach(p => p.remove());

    box.onclick = async e => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-restore],button[data-prune],button[data-forget]');
      if (!b) return;
      b.disabled = true;
      try {
        if (b.dataset.restore) {
          const r = await api.restoreSession(b.dataset.restore);
          toast(t('storage.restored', { n: fmtNumber(r.files) }), 'ok');
        } else if (b.dataset.prune) {
          if (!confirm(t('storage.prune.confirm'))) { b.disabled = false; return; }
          await api.archiveSession(b.dataset.prune, true);
          toast(t('storage.pruned'), 'ok');
        } else if (b.dataset.forget) {
          if (!confirm(t('storage.forget.confirm'))) { b.disabled = false; return; }
          await api.forgetArchived(b.dataset.forget);
          toast(t('storage.forgotten'), 'ok');
        }
        await loadStatus();
        await loadList();
      } catch (err) {
        toast(errMsg(err), 'err');
        b.disabled = false;
      }
    };
  };

  $('#stReload', el).onclick = async () => { await loadStatus(); await loadList(); };
  $<HTMLInputElement>('#stAuto', el).onchange = async ev => {
    try {
      status = await api.storageConfig({ autoArchive: (ev.target as HTMLInputElement).checked });
      toast(t('settings.saved'), 'ok');
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };
  $<HTMLButtonElement>('#stArchiveAll', el).onclick = async ev => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    const label = b.innerHTML;
    b.innerHTML = `<span class="spinner"></span>${esc(t('storage.archiving'))}`;
    try {
      const r = await api.archiveAll();
      toast(t('storage.archivedN', { n: r.archived.length }), r.failed.length ? 'info' : 'ok');
      if (r.failed.length) toast(r.failed.map(f => `${f.sessionId}: ${f.error}`).join('\n'), 'err', 6000);
    } catch (e) {
      toast(errMsg(e), 'err');
    }
    b.innerHTML = label;
    b.disabled = false;
    await loadStatus();
    await loadList();
  };

  // ------------------------------------------------------------ SQL console
  const sqlBox = () => $<HTMLTextAreaElement>('#stSql', el);
  const renderResult = () => {
    const box = $('#stResult', el);
    if (!result) return;
    const r = result;
    html(box, `
      <div class="card-head" style="flex-wrap:wrap">${icon('layers')}<h3>${esc(t('graph.result'))}</h3>
        <span class="muted small">${esc(t('graph.rows', { n: fmtNumber(r.rows.length) }))}${r.truncated ? ' +' : ''} · ${fmtNumber(r.ms)} ms</span>
        <span class="spacer"></span>
        <button class="btn sm ghost" id="stExplain">${icon('zap')}${esc(t('graph.explain'))}</button></div>
      ${!r.rows.length ? `<div class="empty"><p>${esc(t('graph.noRows'))}</p></div>` : `
      <div class="table-wrap" style="max-height:560px"><table class="table">
        <thead><tr>${r.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${r.rows.map(row => `<tr>${r.columns.map(c => `<td class="gcell">${sqlCell(row[c])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`}`);
    $('#stExplain', box).onclick = () => askAssistant(t('storage.explain.prompt', { query: lastSql, rows: JSON.stringify(r.rows.slice(0, 30)).slice(0, 6000) }));
  };
  const run = async () => {
    const q = sqlBox().value.trim();
    if (!q) return;
    lastSql = q;
    html($('#stResult', el), '<div class="empty"><span class="spinner"></span></div>');
    try {
      result = await api.storageSql(q);
      renderResult();
    } catch (e) {
      html($('#stResult', el), `<div class="ai-msg error">${icon('alert')}<span class="ltr">${esc(errMsg(e))}</span></div>`);
    }
  };
  $('#stExamples', el).onclick = e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ex]');
    if (!b) return;
    sqlBox().value = EXAMPLES[Number(b.dataset.ex)].sql;
    void run();
  };
  $('#stRun', el).onclick = () => void run();
  sqlBox().addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run(); }
  });
  const ask = () => {
    const q = $<HTMLTextAreaElement>('#stAsk', el).value.trim();
    if (q) askAssistant(t('storage.ask.prefix') + q);
  };
  $('#stAskBtn', el).onclick = ask;
  $<HTMLTextAreaElement>('#stAsk', el).addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
  });

  api.storageSchema().then(s => { $('#stSchema', el).textContent = s.schema; }).catch(() => undefined);
  renderAll();
  void loadStatus().then(loadList);
}
