// App-wide UI services (toasts, the side drawer, the page header) as tiny external stores, so any
// component - or plain code - can use them; the shell renders them.
'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { t } from './i18n';

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach(fn => fn());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    }
  };
}

function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

// ---------- toasts ----------
export type ToastKind = 'ok' | 'err' | 'info';
export interface Toast { id: number; message: string; kind: ToastKind; fading: boolean }

const toasts = createStore<Toast[]>([]);
let toastId = 0;

export function toast(message: string, kind: ToastKind = 'info', timeout = 3500): void {
  const id = ++toastId;
  toasts.set([...toasts.get(), { id, message, kind, fading: false }]);
  setTimeout(() => toasts.set(toasts.get().map(x => (x.id === id ? { ...x, fading: true } : x))), timeout);
  setTimeout(() => toasts.set(toasts.get().filter(x => x.id !== id)), timeout + 350);
}

export const useToasts = () => useStore(toasts);

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('common.copied'), 'ok', 1500);
  } catch {
    toast(t('common.error'), 'err');
  }
}

// ---------- drawer ----------
export interface DrawerState { open: boolean; title: string; body: ReactNode }

const drawer = createStore<DrawerState>({ open: false, title: '', body: null });

export function openDrawer(title: string, body: ReactNode): void {
  drawer.set({ open: true, title, body });
}

export function closeDrawer(): void {
  drawer.set({ ...drawer.get(), open: false });
}

export const useDrawer = () => useStore(drawer);

// ---------- page header ----------
const header = createStore<{ title: string; subtitle: string }>({ title: '', subtitle: '' });

export const useHeaderState = () => useStore(header);

/** Set the page title / subtitle (and the document title) while the page is shown. */
export function useHeader(title: string, subtitle = ''): void {
  useEffect(() => {
    header.set({ title, subtitle });
    document.title = title ? `${title} · DevTools Extractor` : 'DevTools Extractor';
  }, [title, subtitle]);
}

// ---------- hand-off to the assistant ----------
/** Ask the assistant a question: the assistant page opens with the message already sent. */
export function askAssistant(message: string, navigate: (href: string) => void): void {
  try { sessionStorage.setItem('dx-ask', message); } catch { /* storage blocked */ }
  navigate('/assistant/');
}
