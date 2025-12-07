/**
 * serviceWorkerCollector.ts
 * Collects service worker internals using CDP.
 */
import { Page } from 'playwright';
import { debug, warn } from '../utils/logger';

export async function collectServiceWorkerInfo(page: Page): Promise<any> {
  try {
    const client = await (page.context() as any).newCDPSession(page);
    const registrations = await client.send('ServiceWorker.enable');
    debug('Service worker info collected');
    return registrations;
  } catch (e) {
    warn(`Failed to collect service worker info: ${(e as Error).message}`);
    return null;
  }
}
