/**
 * memoryCollector.ts
 * Collects advanced memory/heap snapshot using CDP.
 */
import { Page } from 'playwright';
import { debug, warn } from '../utils/logger';

export async function collectHeapSnapshot(page: Page): Promise<any> {
  try {
    const client = await (page.context() as any).newCDPSession(page);
    await client.send('HeapProfiler.enable');
    const { profile } = await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    debug('Heap snapshot collected');
    return profile;
  } catch (e) {
    warn(`Failed to collect heap snapshot: ${(e as Error).message}`);
    return null;
  }
}
