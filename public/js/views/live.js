import { api } from '../api.js';
import { icon, COLLECTOR_ICONS } from '../icons.js';
import { t, fmtNumber, fmtTime } from '../i18n.js';
import { state, on, emit } from '../store.js';
import { $, $$, esc, html, toast, openDrawer, fmtBytes, fmtDuration, statusClass, headersTable, debounce, copyText } from '../util.js';
import { renderJson } from '../jsonView.js';

const NET_TYPES = [
  ['all', 'net.all'],
  ['document', 'Doc'],
  ['xhr', 'Fetch/XHR'],
  ['script', 'JS'],
  ['stylesheet', 'CSS'],
  ['image', 'Img'],
  ['font', 'Font'],
  ['other', 'Other']
];

const KEY_MAP = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const isActive = s => s && (s.status === 'running' || s.status === 'starting' || s.status === 'stopping');

export function mount(el, _params, { setHeader }) {
  setHeader(t('live.title'), t('live.subtitle'));
  const cleanups = [];
  let mode = null;
  let finishedSession = state.session && state.session.status === 'finished' ? state.session : null;
  let disposeMode = null;

  const renderMode = () => {
    const s = state.session;
    const next = isActive(s) ? 'running' : 'start';
    if (next === mode) return;
    if (mode === 'running' && s && s.status === 'finished') finishedSession = s;
    disposeMode?.();
    mode = next;
    disposeMode = next === 'running' ? renderRunning(el) : renderStart(el, finishedSession);
  };

  cleanups.push(on('status', renderMode));
  cleanups.push(on('hello', renderMode));
  renderMode();

  return () => {
    disposeMode?.();
    cleanups.forEach(fn => fn());
  };
}

// ---------------------------------------------------------------------------
// start screen
// ---------------------------------------------------------------------------

function renderStart(el, finished) {
  const cfg = state.config || { targetUrl: '', headless: false, collectors: {} };
  const meta = state.meta || { collectors: [], presets: [] };
  const enabled = meta.collectors.filter(c => cfg.collectors[c.name]?.enabled);

  html(el, `
    <div class="stack">
      ${finished ? `
        <div class="card" style="border-color:color-mix(in srgb,var(--ok) 40%,transparent)">
          <div class="row">
            <div class="feature" style="flex:1">
              <div class="ico" style="background:var(--ok-soft);color:var(--ok)">${icon('check')}</div>
              <div>
                <h4>${esc(t('live.finished'))}</h4>
                <p class="ltr">${esc(finished.id)}</p>
                <p>${esc(t('live.finished.text'))}</p>
              </div>
            </div>
            <a class="btn primary" href="#/sessions/${encodeURIComponent(finished.id)}">${icon('eye')}${esc(t('live.openResults'))}</a>
          </div>
        </div>` : ''}

      <section class="hero">
        <h2>${esc(t('live.hero.title'))}</h2>
        <p>${esc(t('live.hero.text'))}</p>
        <form class="start-form" id="startForm">
          <div class="url-wrap">
            ${icon('globe')}
            <input class="input lg ltr" id="url" type="text" autocomplete="url" spellcheck="false"
              placeholder="${esc(t('live.url.placeholder'))}" value="${esc(cfg.targetUrl || '')}">
          </div>
          <button class="btn primary lg" id="startBtn" type="submit">${icon('play')}<span>${esc(t('live.start'))}</span></button>
        </form>
        <div class="start-opts">
          <label><span class="switch"><input type="checkbox" id="headless" ${cfg.headless || meta.forceHeadless ? 'checked' : ''} ${meta.forceHeadless ? 'disabled' : ''}><span></span></span>${esc(t('live.headless'))}</label>
        </div>
      </section>

      <div class="card">
        <div class="card-head">
          <h3>${esc(t('live.enabledCollectors'))}</h3>
          <span class="pill accent">${fmtNumber(enabled.length)} / ${fmtNumber(meta.collectors.length)}</span>
          <span class="spacer"></span>
          <a class="btn sm ghost" href="#/collectors">${icon('settings')}${esc(t('live.editCollectors'))}</a>
        </div>
        <div class="chips">
          ${meta.collectors.map(c => `<span class="chip ${cfg.collectors[c.name]?.enabled ? 'on' : ''}">${icon(COLLECTOR_ICONS[c.name])}${esc(t('col.' + c.name))}</span>`).join('')}
        </div>
      </div>

      <div class="features">
        ${[['network', 'network'], ['mouse', 'click'], ['gauge', 'perf'], ['shield', 'sec']].map(([ic, k]) => `
          <div class="card feature">
            <div class="ico">${icon(ic)}</div>
            <div><h4>${esc(t('live.features.' + k))}</h4><p>${esc(t('live.features.' + k + '.d'))}</p></div>
          </div>`).join('')}
      </div>
    </div>
  `);

  const form = $('#startForm', el);
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('#startBtn', el);
    const url = $('#url', el).value.trim();
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span><span>${esc(t('live.starting'))}</span>`;
    try {
      const summary = await api.start({ url: url || undefined, headless: $('#headless', el).checked });
      state.session = summary;
      // the status event switches the view; emit it too in case the event was missed
      emit('status', summary);
    } catch (err) {
      toast(err.message, 'err', 7000);
      btn.disabled = false;
      btn.innerHTML = `${icon('play')}<span>${esc(t('live.start'))}</span>`;
    }
  };
  $('#url', el).focus();
  return () => {};
}

// ---------------------------------------------------------------------------
// running session
// ---------------------------------------------------------------------------

function renderRunning(el) {
  const s = state.session;
  const vp = state.config?.viewport || { width: 1280, height: 800 };
  const ui = { tab: 'network', netType: 'all', netFilter: '', conLevel: 'all', conFilter: '' };

  html(el, `
    <div class="stack">
      <div class="stats" id="stats"></div>

      <div class="live-grid">
        <div class="browser">
          <div class="browser-bar">
            <button class="icon-btn" data-nav="back" title="${esc(t('live.back'))}">${icon('left')}</button>
            <button class="icon-btn" data-nav="forward" title="${esc(t('live.forward'))}">${icon('right')}</button>
            <button class="icon-btn" data-nav="reload" title="${esc(t('live.reload'))}">${icon('refresh')}</button>
            <form id="navForm" style="flex:1;display:flex;gap:6px">
              <input class="input" id="navUrl" spellcheck="false" value="${esc(s.currentUrl || s.url)}">
            </form>
            <button class="btn sm" id="snapBtn">${icon('camera')}<span>${esc(t('live.snapshot'))}</span></button>
            <button class="btn sm danger" id="stopBtn">${icon('stop')}<span>${esc(t('live.stop'))}</span></button>
          </div>
          <div class="viewport" id="viewport" tabindex="0" style="--vp-ratio:${vp.width} / ${vp.height}">
            <img id="shot" alt="">
            <div class="overlay" id="shotOverlay"><div><span class="spinner"></span><div class="small" style="margin-top:8px">${esc(t('live.preview.loading'))}</div></div></div>
          </div>
          <div class="browser-foot">${icon('keyboard')}<span>${esc(s.headless ? t('live.preview.hint') : t('live.preview.headed') + ' ' + t('live.preview.hint'))}</span></div>
        </div>

        <div class="side-col">
          <div class="card">
            <div class="card-head"><h3>${esc(t('live.timeline'))}</h3><span class="spacer"></span><span class="pill" id="sessionId"></span></div>
            <div class="timeline" id="timeline"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="tabs" id="tabs">
          <button data-tab="network">${icon('network')}${esc(t('tab.network'))}<span class="count" id="cNet">0</span></button>
          <button data-tab="console">${icon('terminal')}${esc(t('tab.console'))}<span class="count" id="cCon">0</span></button>
          <button data-tab="logs">${icon('activity')}${esc(t('tab.logs'))}</button>
        </div>
        <div id="panel"></div>
      </div>
    </div>
  `);

  $('#sessionId', el).textContent = s.id.split('-').slice(2, -1).join('-') || s.id;
  $('#sessionId', el).title = s.id;

  // --- stats ---
  const renderStats = () => {
    const c = state.session?.counts || {};
    const started = new Date(state.session?.startedAt || Date.now()).getTime();
    const items = [
      ['network', 'stat.requests', c.requests, ''],
      ['alert', 'stat.failed', c.failedRequests, c.failedRequests ? 'err' : ''],
      ['terminal', 'stat.console', c.console, ''],
      ['alert', 'stat.errors', c.errors, c.errors ? 'err' : ''],
      ['mouse', 'stat.clicks', c.clicks, ''],
      ['camera', 'stat.snapshots', c.snapshots, 'accent'],
      ['clock', 'stat.duration', null, '', fmtDuration(Date.now() - started)]
    ];
    html($('#stats', el), items.map(([ic, label, v, cls, text]) => `
      <div class="stat ${cls}"><span class="label">${icon(ic)}${esc(t(label))}</span><span class="value">${text ? esc(text) : fmtNumber(v ?? 0)}</span></div>`).join(''));
  };

  // --- timeline ---
  const renderTimeline = () => {
    const snaps = [...(state.session?.snapshots || [])].reverse();
    const pending = state.live.pending;
    const box = $('#timeline', el);
    if (!snaps.length && !pending) {
      html(box, `<div class="empty small">${icon('camera')}<div>${esc(t('live.timeline.empty'))}</div></div>`);
      return;
    }
    html(box, `
      ${pending ? `<div class="tl-item pending"><div class="ico ${pending.reason}"><span class="spinner"></span></div><div class="body"><div class="title">#${pending.seq} · ${esc(t('reason.' + pending.reason))}</div><div class="sub">${esc(t('common.loading'))}</div></div></div>` : ''}
      ${snaps.map(sn => `
        <div class="tl-item">
          <div class="ico ${sn.reason}">${icon(sn.reason === 'click' ? 'mouse' : sn.reason === 'final' ? 'check' : 'camera')}</div>
          <div class="body">
            <div class="title">#${sn.seq} · ${esc(t('reason.' + sn.reason))} <span class="muted small">${esc(fmtTime(sn.createdAt))}</span></div>
            <div class="sub truncate ltr">${sn.click ? `&lt;${esc(sn.click.tagName.toLowerCase())}&gt; ${esc(sn.click.cssSelector || '')}` : esc(sn.url)}</div>
            <div class="sub">${esc(fmtDuration(sn.durationMs))}${Object.keys(sn.errors || {}).length ? ` · <span style="color:var(--err)">${Object.keys(sn.errors).length} ${esc(t('common.error'))}</span>` : ''}</div>
          </div>
          <div class="row" style="gap:4px">
            ${sn.screenshot ? `<button class="icon-btn" data-shot="${esc(sn.screenshot)}" title="screenshot">${icon('image')}</button>` : ''}
            <button class="icon-btn" data-json="${esc(sn.file)}" title="JSON">${icon('code')}</button>
          </div>
        </div>`).join('')}
    `);
  };

  $('#timeline', el).addEventListener('click', async e => {
    const shot = e.target.closest('[data-shot]');
    const json = e.target.closest('[data-json]');
    const id = state.session?.id;
    if (shot) openDrawer('Screenshot', `<img class="full" src="${api.fileUrl(id, shot.dataset.shot)}">`);
    if (json) {
      const body = openDrawer(json.dataset.json, `<div id="jv">${esc(t('common.loading'))}</div>`);
      try { renderJson($('#jv', body), await api.json(id, json.dataset.json), 2); } catch (err) { toast(err.message, 'err'); }
    }
  });

  // --- tabs & panels ---
  const setTab = tab => {
    ui.tab = tab;
    $$('#tabs button', el).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    buildPanel();
  };
  $('#tabs', el).addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });

  const buildPanel = () => {
    const panel = $('#panel', el);
    if (ui.tab === 'network') {
      html(panel, `
        <div class="toolbar">
          <input class="input" id="netFilter" placeholder="${esc(t('net.filter'))}" value="${esc(ui.netFilter)}">
          <div class="seg" id="netType">${NET_TYPES.map(([k, l]) => `<button data-k="${k}" class="${ui.netType === k ? 'active' : ''}">${esc(l.includes('.') ? t(l) : l)}</button>`).join('')}</div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>${esc(t('net.method'))}</th><th>${esc(t('net.status'))}</th><th>${esc(t('net.type'))}</th><th>${esc(t('net.size'))}</th><th>${esc(t('net.time'))}</th><th>${esc(t('net.url'))}</th></tr></thead>
          <tbody id="netBody"></tbody>
        </table></div>`);
      $('#netFilter', panel).oninput = debounce(e => { ui.netFilter = e.target.value; renderNet(); }, 150);
      $('#netType', panel).onclick = e => {
        const b = e.target.closest('button');
        if (!b) return;
        ui.netType = b.dataset.k;
        $$('#netType button', panel).forEach(x => x.classList.toggle('active', x === b));
        renderNet();
      };
      $('#netBody', panel).onclick = e => {
        const tr = e.target.closest('tr[data-id]');
        if (tr) showRequest(tr.dataset.id);
      };
      renderNet();
    } else if (ui.tab === 'console') {
      html(panel, `
        <div class="toolbar">
          <input class="input" id="conFilter" placeholder="${esc(t('console.filter'))}" value="${esc(ui.conFilter)}">
          <div class="seg" id="conLevel">${['all', 'error', 'warn', 'log'].map(k => `<button data-k="${k}" class="${ui.conLevel === k ? 'active' : ''}">${k === 'all' ? esc(t('net.all')) : k}</button>`).join('')}</div>
        </div>
        <div class="console" id="conBody"></div>`);
      $('#conFilter', panel).oninput = debounce(e => { ui.conFilter = e.target.value.toLowerCase(); renderConsole(); }, 150);
      $('#conLevel', panel).onclick = e => {
        const b = e.target.closest('button');
        if (!b) return;
        ui.conLevel = b.dataset.k;
        $$('#conLevel button', panel).forEach(x => x.classList.toggle('active', x === b));
        renderConsole();
      };
      renderConsole();
    } else {
      html(panel, `<div class="console" id="logBody"></div>`);
      renderLogs();
    }
  };

  const typeMatch = (row, type) => {
    if (type === 'all') return true;
    const rt = row.resourceType;
    if (type === 'xhr') return rt === 'xhr' || rt === 'fetch';
    if (type === 'other') return !['document', 'xhr', 'fetch', 'script', 'stylesheet', 'image', 'font'].includes(rt);
    return rt === type;
  };

  const renderNet = () => {
    const body = $('#netBody', el);
    if (!body) return;
    const f = ui.netFilter.toLowerCase();
    const rows = [];
    const order = state.live.order;
    for (let i = order.length - 1; i >= 0 && rows.length < 500; i--) {
      const r = state.live.rows.get(order[i]);
      if (!r || !r.url) continue;
      if (f && !r.url.toLowerCase().includes(f)) continue;
      if (!typeMatch(r, ui.netType)) continue;
      rows.push(r);
    }
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" class="empty">${esc(t('net.empty'))}</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => {
      const resp = r.response;
      const status = r.failure ? `<span class="status-code sx">ERR</span>` : resp ? `<span class="status-code ${statusClass(resp.status)}">${resp.status}</span>` : `<span class="muted small">${esc(t('net.pending'))}</span>`;
      return `<tr class="clickable" data-id="${esc(r.id)}">
        <td><span class="method">${esc(r.method)}</span></td>
        <td>${status}</td>
        <td class="muted">${esc(r.resourceType)}</td>
        <td class="muted mono">${resp ? fmtBytes(resp.size) : ''}</td>
        <td class="muted mono">${esc(fmtTime(r.timestamp))}</td>
        <td class="url" title="${esc(r.url)}">${esc(r.url)}</td>
      </tr>`;
    }).join('');
  };

  const renderConsole = () => {
    const body = $('#conBody', el);
    if (!body) return;
    const lines = state.live.console.filter(m => {
      if (ui.conLevel === 'error' && m.type !== 'error') return false;
      if (ui.conLevel === 'warn' && m.type !== 'warn') return false;
      if (ui.conLevel === 'log' && !['log', 'info', 'debug'].includes(m.type)) return false;
      return !ui.conFilter || (m.text || '').toLowerCase().includes(ui.conFilter);
    }).slice(-500).reverse();
    body.innerHTML = lines.length ? lines.map(m => `
      <div class="line ${esc(m.type)}">
        <span class="t">${esc(fmtTime(m.timestamp))}</span>
        <span class="lvl">${esc(m.pageError ? 'uncaught' : m.type)}</span>
        <span>${esc(m.text)}${m.stack ? `\n<span class="muted">${esc(m.stack)}</span>` : ''}</span>
        ${m.location?.url ? `<span class="src" title="${esc(m.location.url)}">${esc(m.location.url.split('/').pop() || '')}:${m.location.lineNumber ?? ''}</span>` : ''}
      </div>`).join('') : `<div class="empty">${esc(t('console.empty'))}</div>`;
  };

  const renderLogs = () => {
    const body = $('#logBody', el);
    if (!body) return;
    const lines = state.live.logs.slice(-300).reverse();
    body.innerHTML = lines.length ? lines.map(l => `
      <div class="line ${l.level === 'ERROR' ? 'error' : l.level === 'WARN' ? 'warn' : 'info'}">
        <span class="t">${esc(fmtTime(l.timestamp))}</span><span class="lvl">${esc(l.level)}</span><span>${esc(l.message)}</span>
      </div>`).join('') : `<div class="empty">${esc(t('common.noData'))}</div>`;
  };

  const updateCounts = () => {
    const cNet = $('#cNet', el);
    if (cNet) cNet.textContent = fmtNumber(state.live.order.length);
    const cCon = $('#cCon', el);
    if (cCon) cCon.textContent = fmtNumber(state.live.console.length);
  };

  async function showRequest(id) {
    const body = openDrawer(t('net.request'), `<div class="muted">${esc(t('common.loading'))}</div>`);
    try {
      const { request, response } = await api.liveRequest(id);
      const sid = state.session?.id;
      const r = request || {};
      html(body, `
        <div>
          <div class="row" style="margin-bottom:8px">
            <span class="method">${esc(r.method || response?.method || '')}</span>
            ${response ? `<span class="status-code ${statusClass(response.status)}">${response.status} ${esc(response.statusText || '')}</span>` : ''}
            ${r.failure ? `<span class="pill err">${esc(r.failure)}</span>` : ''}
            <span class="pill">${esc(r.resourceType || response?.resourceType || '')}</span>
            ${response?.durationMs != null ? `<span class="pill">${esc(fmtDuration(response.durationMs))}</span>` : ''}
            ${response?.size != null ? `<span class="pill">${esc(fmtBytes(response.size))}</span>` : ''}
            <span class="spacer"></span>
            <button class="btn sm ghost" id="copyUrl">${icon('copy')}${esc(t('common.copy'))}</button>
          </div>
          <pre class="code">${esc(r.url || response?.url || '')}</pre>
        </div>
        <div><h4>${esc(t('net.request'))} · ${esc(t('net.headers'))}</h4>${headersTable(r.headers)}</div>
        ${r.postData ? `<div><h4>${esc(t('net.postData'))}</h4><pre class="code">${esc(r.postData)}</pre></div>` : ''}
        ${response ? `
          <div><h4>${esc(t('net.response'))} · ${esc(t('net.headers'))}</h4>${headersTable(response.headers)}</div>
          ${response.remoteAddress ? `<div class="small muted ltr">${esc(response.remoteAddress.ipAddress)}:${esc(response.remoteAddress.port)}</div>` : ''}
          ${response.securityDetails ? `<div><h4>TLS</h4><div id="tls"></div></div>` : ''}
          <div>
            <div class="row" style="margin-bottom:8px"><h4 style="margin:0">${esc(t('net.body'))}</h4><span class="spacer"></span>
              ${response.fullBodyPath ? `<a class="btn sm" target="_blank" href="${api.fileUrl(sid, response.fullBodyPath)}">${icon('external')}${esc(t('net.openFull'))}</a>` : ''}
            </div>
            <pre class="code">${esc(response.bodySnippet ?? '')}</pre>
          </div>` : ''}
      `);
      if (response?.securityDetails) renderJson($('#tls', body), response.securityDetails, 1);
      $('#copyUrl', body).onclick = () => copyText(r.url || response?.url || '');
    } catch (err) {
      html(body, `<div class="empty">${esc(err.message)}</div>`);
    }
  }

  // --- browser controls ---
  const shot = $('#shot', el);
  const overlay = $('#shotOverlay', el);
  const viewport = $('#viewport', el);
  let alive = true;
  let timer = null;
  let lastUrl = null;

  const refreshShot = async () => {
    clearTimeout(timer);
    if (!alive) return;
    if (document.hidden || state.session?.status !== 'running') {
      timer = setTimeout(refreshShot, 1000);
      return;
    }
    try {
      const res = await fetch('/api/session/screenshot', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      await new Promise(resolve => { shot.onload = resolve; shot.onerror = resolve; shot.src = url; });
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
      overlay.hidden = true;
      timer = setTimeout(refreshShot, 800);
    } catch {
      timer = setTimeout(refreshShot, 1500);
    }
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(refreshShot, 250); };

  const send = async body => {
    try {
      const r = await api.input(body);
      if (r.url) $('#navUrl', el).value = r.url;
    } catch (err) {
      toast(err.message, 'err');
    }
    soon();
  };

  const ripple = (x, y) => {
    const d = document.createElement('div');
    d.className = 'ripple';
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    viewport.appendChild(d);
    setTimeout(() => d.remove(), 700);
  };

  shot.addEventListener('click', e => {
    const rect = shot.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * vp.width;
    const y = ((e.clientY - rect.top) / rect.height) * vp.height;
    ripple(e.clientX - viewport.getBoundingClientRect().left, e.clientY - viewport.getBoundingClientRect().top);
    viewport.focus();
    send({ action: 'click', x: Math.round(x), y: Math.round(y) });
  });

  let wheel = 0;
  const flushWheel = debounce(() => { const d = wheel; wheel = 0; if (d) send({ action: 'scroll', deltaY: d }); }, 120);
  viewport.addEventListener('wheel', e => { e.preventDefault(); wheel += e.deltaY; flushWheel(); }, { passive: false });

  let typed = '';
  const flushTyped = debounce(() => { const s = typed; typed = ''; if (s) send({ action: 'type', text: s }); }, 150);
  viewport.addEventListener('keydown', e => {
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      typed += e.key;
      flushTyped();
    } else if (KEY_MAP.has(e.key) || ((e.ctrlKey || e.metaKey) && e.key.length === 1)) {
      e.preventDefault();
      const s = typed; typed = '';
      const key = (e.ctrlKey || e.metaKey) && e.key.length === 1 ? `Control+${e.key}` : e.key;
      (s ? send({ action: 'type', text: s }) : Promise.resolve()).then(() => send({ action: 'press', key }));
    }
  });

  $$('[data-nav]', el).forEach(b => { b.onclick = () => send({ action: b.dataset.nav }); });
  $('#navForm', el).onsubmit = e => { e.preventDefault(); send({ action: 'navigate', url: $('#navUrl', el).value }); };

  $('#snapBtn', el).onclick = async () => {
    const b = $('#snapBtn', el);
    b.disabled = true;
    try { await api.snapshot(); } catch (err) { toast(err.message, 'err'); }
    b.disabled = false;
  };
  $('#stopBtn', el).onclick = async () => {
    const b = $('#stopBtn', el);
    b.disabled = true;
    $('#snapBtn', el).disabled = true;
    b.innerHTML = `<span class="spinner"></span><span>${esc(t('live.stopping'))}</span>`;
    try { await api.stop(); } catch (err) { toast(err.message, 'err'); b.disabled = false; }
  };

  // --- live updates ---
  let dirty = { net: true, con: true, logs: true, tl: true };
  const unsub = on('*', type => {
    if (type === 'request' || type === 'response') dirty.net = true;
    else if (type === 'console') dirty.con = true;
    else if (type === 'log') dirty.logs = true;
    else if (type === 'snapshot' || type === 'snapshot-start') { dirty.tl = true; if (type === 'snapshot') soon(); }
    else if (type === 'navigated') {
      const input = $('#navUrl', el);
      if (input && document.activeElement !== input) input.value = state.session?.currentUrl || input.value;
      soon();
    } else if (type === 'click') soon();
  });

  const tick = setInterval(() => {
    renderStats();
    updateCounts();
    if (dirty.tl) { renderTimeline(); dirty.tl = false; }
    if (dirty.net && ui.tab === 'network') { renderNet(); dirty.net = false; }
    if (dirty.con && ui.tab === 'console') { renderConsole(); dirty.con = false; }
    if (dirty.logs && ui.tab === 'logs') { renderLogs(); dirty.logs = false; }
    if (state.session?.status === 'stopping') {
      const b = $('#stopBtn', el);
      if (b && !b.disabled) { b.disabled = true; b.innerHTML = `<span class="spinner"></span><span>${esc(t('live.stopping'))}</span>`; }
    }
  }, 500);

  renderStats();
  renderTimeline();
  setTab('network');
  refreshShot();

  return () => {
    alive = false;
    clearTimeout(timer);
    clearInterval(tick);
    unsub();
    if (lastUrl) URL.revokeObjectURL(lastUrl);
  };
}
