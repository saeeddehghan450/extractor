import { api } from './api.js';
import { hydrateIcons, icon } from './icons.js';
import { getLang, setLang, t, translateDom } from './i18n.js';
import { state, on, connectEvents, loadLive } from './store.js';
import { $, $$, closeDrawer, errMsg, statusPill, toast } from './util.js';
import type { MountFn, Unmount } from './types.js';
import * as live from './views/live.js';
import * as collectors from './views/collectors.js';
import * as sessions from './views/sessions.js';
import * as settings from './views/settings.js';

const routes: Record<string, { mount: MountFn }> = { live, collectors, sessions, settings };
let unmount: Unmount | null = null;
let currentRoute = '';

function parseHash(): { name: string; params: string[] } {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: routes[name] ? name : 'live', params: rest.map(decodeURIComponent) };
}

export function setHeader(title: string, subtitle = ''): void {
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
  document.title = `${title} · DevTools Extractor`;
}

function render() {
  const { name, params } = parseHash();
  currentRoute = name;
  if (unmount) { try { unmount(); } catch (e) { console.error(e); } }
  closeDrawer();
  $('#sidebar').classList.remove('open');
  $$<HTMLAnchorElement>('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  // fresh element per route so listeners of the previous view never leak
  const old = $('#view');
  const view = old.cloneNode(false) as HTMLElement;
  old.replaceWith(view);
  const res = routes[name].mount(view, params, { setHeader });
  unmount = typeof res === 'function' ? res : null;
  hydrateIcons(view);
}

function renderTopStatus() {
  const s = state.session;
  const box = $('#topStatus');
  if (s && (s.status === 'running' || s.status === 'starting' || s.status === 'stopping')) {
    box.innerHTML = `${statusPill(s.status)}${currentRoute !== 'live' ? `<a class="btn sm" href="#/live">${icon('eye')}${t('nav.live')}</a>` : ''}`;
  } else {
    box.innerHTML = '';
  }
  hydrateIcons(box);
  const liveLink = $('#nav a[data-route="live"]');
  liveLink.querySelector('.badge-live')?.remove();
  if (s && s.status === 'running') {
    liveLink.insertAdjacentHTML('beforeend', '<span class="pill ok live badge-live"><span class="dot"></span></span>');
  }
}

function renderConn() {
  const el = $('#conn');
  el.classList.toggle('on', state.connected);
  el.classList.toggle('off', !state.connected);
  $('#connText').textContent = t(state.connected ? 'conn.on' : 'conn.off');
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('dx-theme', theme); } catch { /* storage may be blocked */ }
  $('#themeBtn').innerHTML = icon(theme === 'light' ? 'moon' : 'sun');
}

function refreshChrome() {
  translateDom();
  $('#langLabel').textContent = getLang() === 'fa' ? 'EN' : 'فا';
  renderConn();
  renderTopStatus();
}

async function init() {
  hydrateIcons();
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  refreshChrome();

  $('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  $('#langBtn').onclick = () => { setLang(getLang() === 'fa' ? 'en' : 'fa'); refreshChrome(); render(); };
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#drawerClose').onclick = closeDrawer;
  $('#drawerBackdrop').onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  try {
    [state.meta, state.config] = await Promise.all([api.meta(), api.config()]);
    await loadLive();
  } catch (e) {
    toast(errMsg(e), 'err');
  }

  connectEvents();
  on('connection', renderConn);
  // only announce transitions that happen while the dashboard is open
  let lastStatus = state.session ? `${state.session.id}:${state.session.status}` : '';
  on('status', s => {
    renderTopStatus();
    const key = s ? `${s.id}:${s.status}` : '';
    if (key === lastStatus) return;
    const known = lastStatus.startsWith(`${s?.id}:`);
    lastStatus = key;
    if (!known && s?.status !== 'running') return;
    if (s?.status === 'finished') toast(t('live.finished'), 'ok');
    if (s?.status === 'error' && s.error) toast(s.error, 'err', 6000);
  });
  on('hello', renderTopStatus);

  window.addEventListener('hashchange', () => { render(); renderTopStatus(); });
  render();
  renderTopStatus();
}

init();
