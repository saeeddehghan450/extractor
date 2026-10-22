/**
 * memoryCollector.ts
 * Memory information using CDP:
 *  - JS heap usage on every snapshot
 *  - full heap snapshot (.heapsnapshot, loadable in DevTools > Memory) on manual/final snapshots
 */
import fs from 'fs';
import path from 'path';
import { CollectorContext } from '../types';
import { ensureDir, relPath } from '../utils/fileUtils';
import { debug, warn } from '../utils/logger';

async function takeHeapSnapshot(ctx: CollectorContext): Promise<{ path: string; bytes: number } | null> {
  const cdp = ctx.cdp!;
  const dir = path.join(ctx.sessionDir, 'memory');
  ensureDir(dir);
  const file = path.join(dir, `heap-${ctx.seq}.heapsnapshot`);
  const stream = fs.createWriteStream(file, 'utf-8');
  let bytes = 0;
  const onChunk = (e: { chunk: string }) => { bytes += e.chunk.length; stream.write(e.chunk); };
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  try {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  } finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await new Promise<void>(resolve => stream.end(() => resolve()));
  }
  return { path: relPath(ctx.sessionDir, file), bytes };
}

export async function collectHeapSnapshot(ctx: CollectorContext): Promise<any> {
  if (!ctx.cdp) return null;
  const result: any = { heapUsage: null, heapSnapshotPath: null, heapSnapshotBytes: null };
  try {
    const usage = await ctx.cdp.send('Runtime.getHeapUsage');
    result.heapUsage = { usedSize: usage.usedSize, totalSize: usage.totalSize };
    result.domCounters = await ctx.cdp.send('Memory.getDOMCounters').catch(() => null);
  } catch (e) {
    warn(`Failed to read heap usage: ${(e as Error).message}`);
  }
  if (ctx.reason !== 'click') {
    try {
      const snap = await takeHeapSnapshot(ctx);
      if (snap) {
        result.heapSnapshotPath = snap.path;
        result.heapSnapshotBytes = snap.bytes;
        debug(`Heap snapshot saved: ${snap.path}`);
      }
    } catch (e) {
      warn(`Failed to collect heap snapshot: ${(e as Error).message}`);
    }
  }
  return result;
}
