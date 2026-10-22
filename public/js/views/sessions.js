import { api } from '../api.js';
import { icon, COLLECTOR_ICONS } from '../icons.js';
import { t, fmtNumber, fmtDate, fmtTime } from '../i18n.js';
import { state } from '../store.js';
import { $, $$, esc, html, toast, openDrawer, fmtBytes, fmtDuration, statusClass, statusPill, hostOf, headersTable, debounce } from '../util.js';
import { renderJson, expandAll } from '../jsonView.js';

export function mount(el, params, ctx) {
  if (params[0]) return mountDetail(el, params[0], ctx);
  return mountList(el, ctx);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function mountList(el, { setHeader }) {
  setHeader(t('sessions.title'), t('sessions.subtitle'));
  let all = [];
  let filter = '';

  const render = () => {
    const list = all.filter(s => !filter || s.url.toLowerCase().includes(filter));
    if (!all.length) {
      html(el, `<div class="card empty">${icon('archive')}<div>${esc(t('sessions.empty'))}</div>
        <div style="margin-top:14px"><a class="btn primary" href="#/live">${icon('play')}${esc(t('sessions.empty.cta'))}</a></div></div>`);
      return;
    }
    html(el, `
      <div class="toolbar">
        <input class="input" id="q" placeholder="${esc(t('sessions.search'))}" value="${esc(filter)}">
        <span class="spacer"></span>
        <span class="muted small">${esc(t('common.items', { n: fmtNumber(list.length) }))}</span>
      </div>
      <div class="session-list">
        ${list.map(s => `
          <div class="session-row" data-id="${esc(s.id)}">
            <div style="min-width:0">
              <div class="row" style="gap:8px">
                <span class="host">${esc(hostOf(s.url))}</span>
                ${statusPill(s.status)}
                ${s.headless ? '<span class="pill">headless</span>' : ''}
              </div>
              <div class="url truncate">${esc(s.url)}</div>
              <div class="muted small">${esc(fmtDate(s.startedAt))}${s.endedAt ? ' · ' + esc(fmtDuration(new Date(s.endedAt) - new Date(s.startedAt))) : ''}</div>
            </div>
            <div class="metrics">
              <span title="${esc(t('stat.requests'))}">${icon('network')}${fmtNumber(s.counts?.requests ?? 0)}</span>
              <span title="${esc(t('stat.console'))}">${icon('terminal')}${fmtNumber(s.counts?.console ?? 0)}</span>
              <span title="${esc(t('stat.errors'))}" style="${s.counts?.errors ? 'color:var(--err)' : ''}">${icon('alert')}${fmtNumber(s.counts?.errors ?? 0)}</span>
              <span title="${esc(t('stat.snapshots'))}">${icon('camera')}${fmtNumber(s.counts?.snapshots ?? 0)}</span>
            </div>
            <div class="actions">
              ${s.analysisFile ? `<a class="icon-btn" title="${esc(t('sessions.download'))}" href="${api.fileUrl(s.id, 'analysis.json', true)}" data-stop>${icon('download')}</a>` : ''}
              <button class="icon-btn" title="${esc(t('common.delete'))}" data-del="${esc(s.id)}">${icon('trash')}</button>
            </div>
          </div>`).join('')}
      </div>`);
    const q = $('#q', el);
    q.oninput = debounce(e => { filter = e.target.value.toLowerCase(); render(); $('#q', el).focus(); }, 200);
  };

  el.addEventListener('click', async e => {
    if (e.target.closest('[data-stop]')) return;
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (!confirm(t('sessions.delete.confirm'))) return;
      try {
        await api.deleteSession(del.dataset.del);
        all = all.filter(s => s.id !== del.dataset.del);
        toast(t('sessions.deleted'), 'ok');
        render();
      } catch (err) { toast(err.message, 'err'); }
      return;
    }
    const row = e.target.closest('.session-row');
    if (row) location.hash = `#/sessions/${encodeURIComponent(row.dataset.id)}`;
  });

  html(el, `<div class="empty">${esc(t('common.loading'))}</div>`);
  api.sessions().then(list => { all = list; render(); }).catch(err => toast(err.message, 'err'));
}

// ---------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------

function mountDetail(el, id, { setHeader }) {
  setHeader(t('sessions.title'), id);
  let summary = null;
  let analysis = null;
  let tab = 'overview';
  const netUi = { filter: '', type: 'all' };

  html(el, `<div class="empty">${esc(t('common.loading'))}</div>`);

  const load = async () => {
    try {
      summary = await api.savedSession(id);
    } catch (err) {
      html(el, `<div class="card empty">${icon('alert')}<div>${esc(t('sessions.notFound'))}</div><div style="margin-top:12px"><a class="btn" href="#/sessions">${esc(t('sessions.back'))}</a></div></div>`);
      return;
    }
    if (summary.analysisFile) {
      try { analysis = await api.json(id, 'analysis.json'); } catch (err) { toast(err.message, 'err'); }
    }
    setHeader(hostOf(summary.url), fmtDate(summary.startedAt));
    renderShell();
  };

  const renderShell = () => {
    const modules = analysis ? (state.meta?.collectors || []).filter(c => analysis[c.name] !== undefined) : [];
    html(el, `
      <div class="detail-head">
        <div class="meta">
          <div class="row" style="gap:8px;margin-bottom:4px"><a class="btn sm ghost" href="#/sessions">${icon(document.dir === 'rtl' ? 'right' : 'left')}${esc(t('sessions.back'))}</a>${statusPill(summary.status)}</div>
          <h2>${esc(analysis?.elements?.overview?.title || hostOf(summary.url))}</h2>
          <div class="url">${esc(summary.url)}</div>
          <div class="muted small">${esc(t('sessions.started'))}: ${esc(fmtDate(summary.startedAt))}${summary.endedAt ? ` · ${esc(t('sessions.ended'))}: ${esc(fmtDate(summary.endedAt))}` : ''}</div>
        </div>
        <div class="row">
          ${summary.analysisFile ? `<a class="btn primary" href="${api.fileUrl(id, 'analysis.json', true)}">${icon('download')}${esc(t('sessions.download'))}</a>` : ''}
          <button class="btn danger" id="delBtn">${icon('trash')}${esc(t('common.delete'))}</button>
        </div>
      </div>
      ${summary.error ? `<div class="card" style="border-color:var(--err);margin-bottom:16px;color:var(--err)">${icon('alert')} ${esc(summary.error)}</div>` : ''}
      <div class="tabs" id="dTabs">
        ${[['overview', 'activity'], ['snapshots', 'camera'], ['network', 'network'], ['console', 'terminal'], ['modules', 'layers'], ['files', 'folder']]
          .filter(([k]) => analysis || k === 'files' || k === 'overview' || k === 'snapshots')
          .map(([k, ic]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${icon(ic)}${esc(t('tab.' + k))}</button>`).join('')}
      </div>
      <div id="dPanel"></div>
    `);
    $('#delBtn', el).onclick = async () => {
      if (!confirm(t('sessions.delete.confirm'))) return;
      try {
        await api.deleteSession(id);
        toast(t('sessions.deleted'), 'ok');
        location.hash = '#/sessions';
      } catch (err) { toast(err.message, 'err'); }
    };
    $('#dTabs', el).onclick = e => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      tab = b.dataset.tab;
      $$('#dTabs button', el).forEach(x => x.classList.toggle('active', x === b));
      renderPanel(modules);
    };
    renderPanel(modules);
  };

  const panel = () => $('#dPanel', el);

  const renderPanel = modules => {
    if (tab === 'overview') return renderOverview();
    if (tab === 'snapshots') return renderSnapshots();
    if (tab === 'network') return renderNetwork();
    if (tab === 'console') return renderConsole();
    if (tab === 'modules') return renderModules(modules);
    if (tab === 'files') return renderFiles();
  };

  // --- overview ---
  const renderOverview = () => {
    const c = summary.counts || {};
    const a = analysis || {};
    const ov = a.elements?.overview;
    const sec = a.security;
    const perf = a.performance;
    const nav = perf?.timing?.navigation;
    const ms = v => (v == null ? '—' : t('common.ms', { n: fmtNumber(v) }));
    const kv = rows => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
    const card = (ic, title, body) => `<div class="card"><div class="card-head">${icon(ic)}<h3>${esc(title)}</h3></div>${body}</div>`;
    const yesNo = b => (b ? `<span class="pill ok">${esc(t('ins.yes'))}</span>` : `<span class="pill err">${esc(t('ins.no'))}</span>`);

    const cards = [];
    if (ov) cards.push(card('code', t('ins.page'), kv([
      [t('ins.title'), esc(ov.title || '—')],
      [t('ins.elements'), fmtNumber(ov.elementCount)],
      [t('ins.forms'), fmtNumber(ov.forms?.length ?? 0)],
      [t('ins.links'), fmtNumber(ov.links)],
      ['lang / dir', esc(`${ov.lang || '—'} / ${ov.dir || '—'}`)]
    ])));
    if (sec) cards.push(card('shield', t('ins.security'), `${kv([
      [t('ins.secure'), yesNo(sec.isSecureContext)],
      sec.certificate ? [t('ins.issuer'), esc(sec.certificate.issuer || '—')] : null,
      sec.certificate ? ['TLS', esc(sec.certificate.protocol || '—')] : null,
      [t('ins.mixed'), fmtNumber(sec.mixedContent?.length ?? 0)],
      [t('ins.cookieIssues'), fmtNumber(sec.cookieIssues?.length ?? 0)]
    ])}
      <div class="small muted" style="margin:12px 0 6px">${esc(t('ins.missingHeaders'))}</div>
      <div class="chips">${(sec.missingHeaders || []).length ? sec.missingHeaders.map(h => `<span class="chip" style="color:var(--warn)">${esc(h)}</span>`).join('') : `<span class="pill ok">${esc(t('ins.none'))}</span>`}</div>`));
    if (perf) cards.push(card('gauge', t('ins.performance'), kv([
      [t('ins.ttfb'), ms(nav?.ttfb)],
      [t('ins.dcl'), ms(nav?.domContentLoaded)],
      [t('ins.load'), ms(nav?.load)],
      [t('ins.fcp'), ms(perf.timing?.paint?.['first-contentful-paint'])],
      [t('ins.lcp'), ms(perf.timing?.largestContentfulPaint?.time)],
      [t('ins.cls'), esc(perf.timing?.cumulativeLayoutShift ?? '—')],
      perf.metrics ? [t('ins.heap'), fmtBytes(perf.metrics.JSHeapUsedSize)] : null
    ])));
    if (a.accessibility) cards.push(card('a11y', t('ins.a11y'), kv([
      [t('ins.a11yNodes'), fmtNumber(a.accessibility.visibleNodes)],
      [t('ins.a11yIssues'), a.accessibility.issueCount ? `<span style="color:var(--warn)">${fmtNumber(a.accessibility.issueCount)}</span>` : fmtNumber(0)]
    ])));
    if (a.scripts || a.css) cards.push(card('file', t('ins.sources'), kv([
      a.scripts ? [t('ins.scripts'), fmtNumber(a.scripts.external?.length ?? 0)] : null,
      a.scripts ? [t('ins.inline'), fmtNumber(a.scripts.inlineCount ?? 0)] : null,
      a.css ? [t('ins.stylesheets'), fmtNumber(a.css.stylesheets?.length ?? 0)] : null
    ])));
    if (a.application) cards.push(card('database', t('ins.storage'), kv([
      [t('ins.cookies'), fmtNumber(a.application.cookies?.length ?? 0)],
      [t('ins.local'), fmtNumber(Object.keys(a.application.storageInfo?.localStorage || {}).length)],
      [t('ins.idb'), fmtNumber(Object.keys(a.application.storageInfo?.indexedDB || {}).length)]
    ])));
    const devFiles = [
      perf?.tracePath ? [t('ins.trace'), perf.tracePath] : null,
      a.memory?.heapSnapshotPath ? [t('ins.heapFile'), a.memory.heapSnapshotPath] : null
    ].filter(Boolean);
    if (devFiles.length) cards.push(card('download', 'DevTools', `<p class="muted small" style="margin-top:0">${esc(t('ins.devtoolsHint'))}</p>
      <ul class="list-plain">${devFiles.map(([label, p]) => `<li>${icon('file')}<span style="flex:1">${esc(label)}</span><a class="btn sm" href="${api.fileUrl(id, p, true)}">${icon('download')}${esc(t('common.download'))}</a></li>`).join('')}</ul>`));

    html(panel(), `
      <div class="stack">
        <div class="stats">
          ${[['network', 'stat.requests', c.requests], ['alert', 'stat.failed', c.failedRequests, c.failedRequests ? 'err' : ''], ['terminal', 'stat.console', c.console], ['alert', 'stat.errors', c.errors, c.errors ? 'err' : ''], ['mouse', 'stat.clicks', c.clicks], ['camera', 'stat.snapshots', c.snapshots, 'accent']]
            .map(([ic, l, v, cls]) => `<div class="stat ${cls || ''}"><span class="label">${icon(ic)}${esc(t(l))}</span><span class="value">${fmtNumber(v ?? 0)}</span></div>`).join('')}
        </div>
        ${analysis ? '' : `<div class="card muted">${esc(t('sessions.noAnalysis'))}</div>`}
        <div class="chips">${(summary.collectors || []).map(n => `<span class="chip on">${icon(COLLECTOR_ICONS[n])}${esc(t('col.' + n))}</span>`).join('')}</div>
        <div class="insights">${cards.join('')}</div>
      </div>`);
  };

  // --- snapshots ---
  const renderSnapshots = () => {
    const snaps = summary.snapshots || [];
    if (!snaps.length) {
      html(panel(), `<div class="card empty">${icon('camera')}<div>${esc(t('live.timeline.empty'))}</div></div>`);
      return;
    }
    html(panel(), `<div class="gallery">${snaps.map(s => `
      <div class="shot">
        ${s.screenshot ? `<img loading="lazy" src="${api.fileUrl(id, s.screenshot)}" data-img="${esc(s.screenshot)}" alt="">` : `<div class="noimg">${icon('image')}</div>`}
        <div class="info">
          <div class="row"><strong>#${s.seq} · ${esc(t('reason.' + s.reason))}</strong><span class="muted small">${esc(fmtTime(s.createdAt))}</span></div>
          ${s.click ? `<div class="small truncate ltr" title="${esc(s.click.cssSelector || '')}">${esc(t('sessions.click'))} &lt;${esc(s.click.tagName.toLowerCase())}&gt; ${esc(s.click.innerText || s.click.cssSelector || '')}</div>` : `<div class="small muted truncate ltr">${esc(s.url)}</div>`}
          <div class="row" style="justify-content:flex-start;gap:6px">
            <button class="btn sm" data-json="${esc(s.file)}">${icon('code')}${esc(t('sessions.openJson'))}</button>
            ${s.html ? `<a class="btn sm ghost" target="_blank" href="${api.fileUrl(id, s.html)}">${icon('external')}${esc(t('sessions.openHtml'))}</a>` : ''}
          </div>
        </div>
      </div>`).join('')}</div>`);
    panel().onclick = async e => {
      const img = e.target.closest('[data-img]');
      if (img) openDrawer('Screenshot', `<img class="full" src="${api.fileUrl(id, img.dataset.img)}">`);
      const js = e.target.closest('[data-json]');
      if (js) {
        const body = openDrawer(js.dataset.json, `<div id="jv">${esc(t('common.loading'))}</div>`);
        try { renderJson($('#jv', body), await api.json(id, js.dataset.json), 2); } catch (err) { toast(err.message, 'err'); }
      }
    };
  };

  // --- network ---
  const renderNetwork = () => {
    const reqs = analysis?.network?.requests || [];
    const resps = new Map((analysis?.network?.responses || []).map(r => [r.requestId, r]));
    html(panel(), `
      <div class="toolbar">
        <input class="input" id="nf" placeholder="${esc(t('net.filter'))}" value="${esc(netUi.filter)}">
        <div class="seg" id="nt">${['all', 'document', 'xhr', 'script', 'stylesheet', 'image', 'other'].map(k => `<button data-k="${k}" class="${netUi.type === k ? 'active' : ''}">${esc(k === 'all' ? t('net.all') : k)}</button>`).join('')}</div>
      </div>
      <div class="table-wrap" style="max-height:640px"><table class="table">
        <thead><tr><th>${esc(t('net.method'))}</th><th>${esc(t('net.status'))}</th><th>${esc(t('net.type'))}</th><th>${esc(t('net.size'))}</th><th>${esc(t('net.time'))}</th><th>${esc(t('net.url'))}</th></tr></thead>
        <tbody id="nb"></tbody>
      </table></div>`);
    const fill = () => {
      const f = netUi.filter.toLowerCase();
      const rows = reqs.filter(r => (!f || r.url.toLowerCase().includes(f)) && (netUi.type === 'all'
        || (netUi.type === 'xhr' ? ['xhr', 'fetch'].includes(r.resourceType)
          : netUi.type === 'other' ? !['document', 'xhr', 'fetch', 'script', 'stylesheet', 'image'].includes(r.resourceType)
            : r.resourceType === netUi.type))).slice(0, 2000);
      $('#nb', panel()).innerHTML = rows.length ? rows.map(r => {
        const resp = resps.get(r.id);
        return `<tr class="clickable" data-id="${esc(r.id)}">
          <td><span class="method">${esc(r.method)}</span></td>
          <td>${r.failure ? '<span class="status-code sx">ERR</span>' : resp ? `<span class="status-code ${statusClass(resp.status)}">${resp.status}</span>` : '—'}</td>
          <td class="muted">${esc(r.resourceType)}</td>
          <td class="muted mono">${resp ? fmtBytes(resp.size) : ''}</td>
          <td class="muted mono">${resp?.durationMs != null ? esc(fmtDuration(resp.durationMs)) : ''}</td>
          <td class="url" title="${esc(r.url)}">${esc(r.url)}</td></tr>`;
      }).join('') : `<tr><td colspan="6" class="empty">${esc(t('net.empty'))}</td></tr>`;
    };
    $('#nf', panel()).oninput = debounce(e => { netUi.filter = e.target.value; fill(); }, 150);
    $('#nt', panel()).onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      netUi.type = b.dataset.k;
      $$('#nt button', panel()).forEach(x => x.classList.toggle('active', x === b));
      fill();
    };
    $('#nb', panel()).onclick = e => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const r = reqs.find(x => x.id === tr.dataset.id);
      const resp = resps.get(tr.dataset.id);
      const body = openDrawer(`${r.method} ${hostOf(r.url)}`, `
        <pre class="code">${esc(r.url)}</pre>
        <div><h4>${esc(t('net.request'))} · ${esc(t('net.headers'))}</h4>${headersTable(r.headers)}</div>
        ${r.postData ? `<div><h4>${esc(t('net.postData'))}</h4><pre class="code">${esc(r.postData)}</pre></div>` : ''}
        ${resp ? `<div><h4>${esc(t('net.response'))} · ${resp.status} ${esc(resp.statusText || '')}</h4>${headersTable(resp.headers)}</div>
          ${resp.securityDetails ? `<div><h4>TLS</h4><div id="tls"></div></div>` : ''}
          <div><div class="row" style="margin-bottom:8px"><h4 style="margin:0">${esc(t('net.body'))}</h4><span class="spacer"></span>
            ${resp.fullBodyPath ? `<a class="btn sm" target="_blank" href="${api.fileUrl(id, resp.fullBodyPath)}">${icon('external')}${esc(t('net.openFull'))}</a>` : ''}</div>
            <pre class="code">${esc(resp.bodySnippet ?? '')}</pre></div>` : ''}`);
      if (resp?.securityDetails) renderJson($('#tls', body), resp.securityDetails, 1);
    };
    fill();
  };

  // --- console ---
  const renderConsole = () => {
    const c = analysis?.console || { logs: [], pageErrors: [], dialogs: [] };
    const lines = [
      ...c.logs,
      ...c.pageErrors.map(e => ({ timestamp: e.timestamp, type: 'error', text: e.message, stack: e.stack, pageError: true })),
      ...c.dialogs.map(d => ({ timestamp: d.timestamp, type: 'info', text: `[dialog:${d.type}] ${d.message}` }))
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    html(panel(), `<div class="console" style="max-height:680px">${lines.length ? lines.map(m => `
      <div class="line ${esc(m.type)}">
        <span class="t">${esc(fmtTime(m.timestamp))}</span><span class="lvl">${esc(m.pageError ? 'uncaught' : m.type)}</span>
        <span>${esc(m.text)}${m.stack ? `\n<span class="muted">${esc(m.stack)}</span>` : ''}</span>
        ${m.location?.url ? `<span class="src" title="${esc(m.location.url)}">${esc(m.location.url.split('/').pop() || '')}:${m.location.lineNumber ?? ''}</span>` : ''}
      </div>`).join('') : `<div class="empty">${esc(t('console.empty'))}</div>`}</div>`);
  };

  // --- modules ---
  const renderModules = modules => {
    if (!modules.length) {
      html(panel(), `<div class="card empty">${esc(t('common.noData'))}</div>`);
      return;
    }
    let active = modules[0].name;
    html(panel(), `
      <div class="module-layout">
        <div class="module-list" id="ml">${modules.map(m => `<button data-m="${esc(m.name)}">${icon(COLLECTOR_ICONS[m.name])}${esc(t('col.' + m.name))}</button>`).join('')}</div>
        <div class="stack" style="gap:10px;min-width:0">
          <div class="row">
            <strong id="mTitle"></strong><span class="spacer"></span>
            <div class="seg" id="mMode"><button data-v="tree" class="active">${esc(t('common.tree'))}</button><button data-v="raw">${esc(t('common.raw'))}</button></div>
            <button class="btn sm ghost" id="mExpand">${esc(t('common.expandAll'))}</button>
            <a class="btn sm" id="mDl">${icon('download')}${esc(t('common.download'))}</a>
          </div>
          <div id="mView"></div>
        </div>
      </div>`);
    let mode = 'tree';
    const show = () => {
      $$('#ml button', panel()).forEach(b => b.classList.toggle('active', b.dataset.m === active));
      $('#mTitle', panel()).textContent = `${active}/${active}.json`;
      $('#mDl', panel()).href = api.fileUrl(id, `${active}/${active}.json`, true);
      const view = $('#mView', panel());
      if (mode === 'raw') {
        view.className = '';
        const text = JSON.stringify(analysis[active], null, 2);
        view.innerHTML = `<pre class="code" style="max-height:640px">${esc(text.length > 2_000_000 ? text.slice(0, 2_000_000) + '\n…' : text)}</pre>`;
      } else {
        renderJson(view, analysis[active], 2);
      }
    };
    $('#ml', panel()).onclick = e => { const b = e.target.closest('button'); if (b) { active = b.dataset.m; show(); } };
    $('#mMode', panel()).onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      mode = b.dataset.v;
      $$('#mMode button', panel()).forEach(x => x.classList.toggle('active', x === b));
      show();
    };
    $('#mExpand', panel()).onclick = () => { if (mode === 'tree') expandAll($('#mView', panel())); };
    show();
  };

  // --- files ---
  const renderFiles = async () => {
    html(panel(), `<div class="empty">${esc(t('common.loading'))}</div>`);
    try {
      const files = await api.files(id);
      if (tab !== 'files') return;
      html(panel(), `<div class="table-wrap" style="max-height:680px"><table class="table">
        <thead><tr><th>${esc(t('tab.files'))}</th><th>${esc(t('net.size'))}</th><th></th></tr></thead>
        <tbody>${files.map(f => `<tr>
          <td class="url" title="${esc(f.path)}">${esc(f.path)}</td>
          <td class="muted mono">${fmtBytes(f.size)}</td>
          <td style="white-space:nowrap">
            <a class="btn sm ghost" target="_blank" href="${api.fileUrl(id, f.path)}">${icon('external')}</a>
            <a class="btn sm ghost" href="${api.fileUrl(id, f.path, true)}">${icon('download')}</a>
          </td></tr>`).join('')}</tbody></table></div>`);
    } catch (err) {
      html(panel(), `<div class="empty">${esc(err.message)}</div>`);
    }
  };

  load();
}
