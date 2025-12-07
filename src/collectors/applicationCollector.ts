/**
 * applicationCollector.ts
 * 
 * جمع‌آوری داده‌های Application Tab
 * شامل:
 *  - cookies
 *  - localStorage
 *  - sessionStorage
 *  - indexedDB
 *  - cacheStorage
 */

import { Page, BrowserContext } from 'playwright';
import { StorageInfo } from '../types';
import { debug, warn } from '../utils/logger';

export async function collectApplicationData(page: Page, context: BrowserContext): Promise<{ cookies: any; storageInfo: StorageInfo }> {
  let storageInfo: StorageInfo = {
    cookies: '',
    localStorage: {},
    sessionStorage: {},
    indexedDB: {}
  };
  let cookies: any[] = [];

  try {
    // Cookies از context
    cookies = await context.cookies();

    // LocalStorage, SessionStorage, IndexedDB
    storageInfo = await page.evaluate(async () => {
      const local: Record<string, string> = { ...localStorage };
      const session: Record<string, string> = { ...sessionStorage };
      const idb: Record<string, any> = {};

      try {
        if ((indexedDB as any).databases) {
          const dbs = await (indexedDB as any).databases();
          for (const db of dbs) {
            idb[db.name] = { version: db.version || null, objectStores: [] };
            try {
              const request = indexedDB.open(db.name);
              request.onsuccess = () => {
                const dbInstance = request.result;
                idb[db.name].objectStores = Array.from(dbInstance.objectStoreNames);
                dbInstance.close();
              };
            } catch {}
          }
        }
      } catch (e) {}

      return {
        cookies: document.cookie,
        localStorage: local,
        sessionStorage: session,
        indexedDB: idb
      };
    });

    debug('Application data جمع‌آوری شد');
  } catch (e) {
    warn(`خطا در جمع‌آوری Application data: ${(e as Error).message}`);
  }

  return { cookies, storageInfo };
}
