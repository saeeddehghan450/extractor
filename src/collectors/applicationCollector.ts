/**
 * applicationCollector.ts
 *
 * Application tab data:
 *  - cookies (from the browser context, including HttpOnly ones)
 *  - localStorage / sessionStorage
 *  - IndexedDB databases and their object stores
 *  - Cache Storage keys
 */

import { CollectorContext, StorageInfo } from '../types';
import { debug, warn } from '../utils/logger';

export async function collectApplicationData(ctx: CollectorContext): Promise<{ cookies: any[]; documentCookie: string; storageInfo: StorageInfo }> {
  let cookies: any[] = [];
  let documentCookie = '';
  let storageInfo: StorageInfo = { localStorage: {}, sessionStorage: {}, indexedDB: {}, cacheStorage: [] };

  try {
    cookies = await ctx.context.cookies();
  } catch (e) {
    warn(`Failed to read cookies: ${(e as Error).message}`);
  }

  try {
    const res = await ctx.page.evaluate(async () => {
      const read = (s: Storage) => {
        const out: Record<string, string> = {};
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k !== null) out[k] = s.getItem(k) ?? '';
        }
        return out;
      };
      let local: Record<string, string> = {};
      let session: Record<string, string> = {};
      try { local = read(localStorage); } catch { /* storage may be blocked */ }
      try { session = read(sessionStorage); } catch { /* storage may be blocked */ }

      const idb: Record<string, { version: number | null; objectStores: string[] }> = {};
      try {
        const dbs = (indexedDB as any).databases ? await (indexedDB as any).databases() : [];
        for (const db of dbs) {
          if (!db.name) continue;
          const stores = await new Promise<string[]>(resolve => {
            try {
              const req = indexedDB.open(db.name);
              req.onsuccess = () => {
                const inst = req.result;
                const names = Array.from(inst.objectStoreNames);
                inst.close();
                resolve(names);
              };
              req.onerror = () => resolve([]);
              req.onblocked = () => resolve([]);
              setTimeout(() => resolve([]), 2000);
            } catch { resolve([]); }
          });
          idb[db.name] = { version: db.version ?? null, objectStores: stores };
        }
      } catch { /* indexedDB unavailable */ }

      let cacheKeys: string[] = [];
      try { cacheKeys = 'caches' in window ? await caches.keys() : []; } catch { /* insecure context */ }

      let docCookie = '';
      try { docCookie = document.cookie; } catch { /* sandboxed */ }

      return { local, session, idb, cacheKeys, docCookie };
    });
    storageInfo = { localStorage: res.local, sessionStorage: res.session, indexedDB: res.idb, cacheStorage: res.cacheKeys };
    documentCookie = res.docCookie;
    debug('Application data collected');
  } catch (e) {
    warn(`Failed to collect application data: ${(e as Error).message}`);
  }

  return { cookies, documentCookie, storageInfo };
}
