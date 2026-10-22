/**
 * serviceWorkerCollector.ts
 * Collects service worker registrations of the page and running workers of the context.
 */
import { CollectorContext } from '../types';
import { debug, warn } from '../utils/logger';

export async function collectServiceWorkerInfo(ctx: CollectorContext): Promise<any> {
  try {
    const registrations = await ctx.page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, controller: null, registrations: [] };
      const regs = await navigator.serviceWorker.getRegistrations();
      const describe = (w: ServiceWorker | null) => (w ? { scriptURL: w.scriptURL, state: w.state } : null);
      return {
        supported: true,
        controller: describe(navigator.serviceWorker.controller),
        registrations: regs.map(r => ({
          scope: r.scope,
          updateViaCache: r.updateViaCache,
          installing: describe(r.installing),
          waiting: describe(r.waiting),
          active: describe(r.active)
        }))
      };
    });
    const runningWorkers = ctx.context.serviceWorkers().map(w => w.url());
    debug('Service worker info collected');
    return { ...registrations, runningWorkers };
  } catch (e) {
    warn(`Failed to collect service worker info: ${(e as Error).message}`);
    return null;
  }
}
