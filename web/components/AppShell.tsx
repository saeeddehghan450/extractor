'use client';

// Sidebar, top bar, drawer and toasts around every page; also starts the live event stream.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from './Icon';
import { StatusPill, Spinner } from './ui';
import { api } from '@/lib/api';
import { getLang, initLang, setLang, subscribeLang, t } from '@/lib/i18n';
import { connectEvents, emit, loadLive, on, state, useStoreVersion } from '@/lib/store';
import { closeDrawer, toast, useDrawer, useHeaderState, useToasts } from '@/lib/ui';
import { errMsg } from '@/lib/format';

const NAV: { href: string; icon: string; key: string }[] = [
  { href: '/', icon: 'activity', key: 'nav.live' },
  { href: '/scraper/', icon: 'database', key: 'nav.scraper' },
  { href: '/collectors/', icon: 'layers', key: 'nav.collectors' },
  { href: '/assistant/', icon: 'zap', key: 'nav.assistant' },
  { href: '/sessions/', icon: 'archive', key: 'nav.sessions' },
  { href: '/graph/', icon: 'share', key: 'nav.graph' },
  { href: '/storage/', icon: 'server', key: 'nav.storage' },
  { href: '/settings/', icon: 'settings', key: 'nav.settings' }
];

function useLang() {
  return useSyncExternalStore(subscribeLang, getLang, () => 'fa' as const);
}

function Drawer() {
  const d = useDrawer();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <div className={`drawer-backdrop ${d.open ? 'open' : ''}`} onClick={closeDrawer} />
      <aside className={`drawer ${d.open ? 'open' : ''}`} aria-hidden={!d.open}>
        <div className="drawer-head">
          <h3>{d.title}</h3>
          <button className="icon-btn" onClick={closeDrawer} aria-label="close"><Icon name="x" /></button>
        </div>
        <div className="drawer-body">{d.open ? d.body : null}</div>
      </aside>
    </>
  );
}

function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts">
      {list.map(x => (
        <div key={x.id} className={`toast ${x.kind}`} style={x.fading ? { opacity: 0, transition: 'opacity .3s' } : undefined}>
          <Icon name={x.kind === 'ok' ? 'check' : x.kind === 'err' ? 'alert' : 'zap'} />
          <div>{x.message}</div>
        </div>
      ))}
    </div>
  );
}

function TopStatus({ pathname }: { pathname: string }) {
  useStoreVersion(['status', 'hello']);
  const s = state.session;
  if (!s || !['running', 'starting', 'stopping'].includes(s.status)) return null;
  return (
    <div className="topbar-status">
      <StatusPill status={s.status} />
      {pathname !== '/' && <Link className="btn sm" href="/"><Icon name="eye" />{t('nav.live')}</Link>}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const lang = useLang();
  const header = useHeaderState();
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useStoreVersion(['connection', 'status', 'hello']);

  // once: language, theme, meta / config / live state, event stream
  useEffect(() => {
    initLang();
    setLang(getLang());
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    (async () => {
      try {
        [state.meta, state.config] = await Promise.all([api.meta(), api.config()]);
        await loadLive();
      } catch (e) {
        toast(errMsg(e), 'err');
      }
      setReady(true);
      emit('local', null);
      connectEvents();
    })();

    // announce transitions that happen while the dashboard is open
    let last = state.session ? `${state.session.id}:${state.session.status}` : '';
    return on('status', s => {
      const key = s ? `${s.id}:${s.status}` : '';
      if (key === last) return;
      const known = last.startsWith(`${s?.id}:`);
      last = key;
      if (!known && s?.status !== 'running') return;
      if (s?.status === 'finished') toast(t('live.finished'), 'ok');
      if (s?.status === 'error' && s.error) toast(s.error, 'err', 6000);
    });
  }, []);

  useEffect(() => { setMenuOpen(false); closeDrawer(); }, [pathname]);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('dx-theme', next); } catch { /* storage blocked */ }
    setTheme(next);
  };

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href.replace(/\/$/, '')));
  const running = state.session?.status === 'running';

  return (
    <>
      <div className="app">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`} id="sidebar">
          <div className="brand">
            <div className="brand-logo" aria-hidden="true">
              <svg viewBox="0 0 32 32"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg)" /><path d="M10 12l-3 4 3 4M22 12l3 4-3 4M18 9l-4 14" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="brand-text">
              <strong>DevTools Extractor</strong>
              <span>{t('brand.tagline')}</span>
            </div>
          </div>
          <nav className="nav" id="nav">
            {NAV.map(n => (
              <Link key={n.href} href={n.href} className={isActive(n.href) ? 'active' : ''}>
                <Icon name={n.icon} /><span>{t(n.key)}</span>
                {n.href === '/' && running && <span className="pill ok live badge-live"><span className="dot" /></span>}
              </Link>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className={`conn ${state.connected ? 'on' : 'off'}`} id="conn"><span className="dot" /><span>{t(state.connected ? 'conn.on' : 'conn.off')}</span></div>
            <div className="foot-actions">
              <button className="icon-btn" id="langBtn" title="Language" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}><span>{lang === 'fa' ? 'EN' : 'فا'}</span></button>
              <button className="icon-btn" id="themeBtn" title={t('theme.toggle')} onClick={toggleTheme}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" aria-label="menu" onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu" /></button>
            <div className="topbar-title">
              <h1>{header.title}</h1>
              <p>{header.subtitle}</p>
            </div>
            <TopStatus pathname={pathname} />
          </header>
          {/* keyed by language: pages re-render every text when it changes */}
          <main className="content" id="view" key={lang}>
            {ready ? children : <div className="empty"><Spinner /></div>}
          </main>
        </div>
      </div>
      <Drawer />
      <Toasts />
    </>
  );
}
