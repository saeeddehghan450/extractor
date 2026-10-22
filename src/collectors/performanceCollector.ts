/**
 * performanceCollector.ts
 *
 * Performance data:
 *  - CDP runtime metrics (layout count, script duration, heap size, ...)
 *  - navigation timing, paint timing, LCP, CLS and a resource summary
 *  - on manual/final snapshots: a Chrome DevTools Performance trace saved to disk
 *    (open it in DevTools > Performance > Load profile)
 */

import path from 'path';
import fs from 'fs';
import { CollectorContext } from '../types';
import { ensureDir, relPath } from '../utils/fileUtils';
import { debug, warn } from '../utils/logger';
import { ensureDomains } from '../utils/cdpClient';

const TRACE_CATEGORIES = [
  'devtools.timeline',
  'v8.execute',
  'blink.user_timing',
  'loading',
  'latencyInfo',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler'
];

async function recordTrace(ctx: CollectorContext, durationMs: number): Promise<string | null> {
  const cdp = ctx.cdp;
  if (!cdp || durationMs <= 0) return null;
  const events: any[] = [];
  const onData = (e: any) => { if (e.value) events.push(...e.value); };
  cdp.on('Tracing.dataCollected', onData);
  try {
    await cdp.send('Tracing.start', {
      categories: TRACE_CATEGORIES.join(','),
      transferMode: 'ReportEvents'
    });
    await ctx.page.waitForTimeout(durationMs);
    const complete = new Promise<void>(resolve => cdp.once('Tracing.tracingComplete', () => resolve()));
    await cdp.send('Tracing.end');
    await Promise.race([complete, new Promise(r => setTimeout(r, 15000))]);
  } finally {
    cdp.off('Tracing.dataCollected', onData);
  }
  const dir = path.join(ctx.sessionDir, 'performance');
  ensureDir(dir);
  const file = path.join(dir, `trace-${ctx.seq}.json`);
  fs.writeFileSync(file, JSON.stringify({ traceEvents: events }), 'utf-8');
  debug(`Performance trace saved: ${file} (${events.length} events)`);
  return relPath(ctx.sessionDir, file);
}

export async function collectPerformance(ctx: CollectorContext, traceMs: number): Promise<any> {
  const result: any = { metrics: null, timing: null, tracePath: null };

  if (ctx.cdp) {
    try {
      await ensureDomains(ctx.cdp, ['Performance']);
      const { metrics } = await ctx.cdp.send('Performance.getMetrics');
      result.metrics = Object.fromEntries(metrics.map(m => [m.name, m.value]));
    } catch (e) {
      warn(`Failed to read performance metrics: ${(e as Error).message}`);
    }
  }

  try {
    result.timing = await ctx.page.evaluate(async () => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const paints = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]));
      const observe = (type: string) => new Promise<any[]>(resolve => {
        try {
          const list: any[] = [];
          const po = new PerformanceObserver(l => list.push(...l.getEntries()));
          po.observe({ type, buffered: true } as any);
          setTimeout(() => { po.disconnect(); resolve(list); }, 50);
        } catch { resolve([]); }
      });
      const lcpEntries = await observe('largest-contentful-paint');
      const shifts = await observe('layout-shift');
      const longTasks = await observe('longtask');
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const byType: Record<string, { count: number; transferSize: number; duration: number }> = {};
      for (const r of resources) {
        const t = r.initiatorType || 'other';
        byType[t] = byType[t] || { count: 0, transferSize: 0, duration: 0 };
        byType[t].count++;
        byType[t].transferSize += r.transferSize || 0;
        byType[t].duration += r.duration;
      }
      const slowest = resources.slice().sort((a, b) => b.duration - a.duration).slice(0, 15)
        .map(r => ({ name: r.name, type: r.initiatorType, duration: Math.round(r.duration), transferSize: r.transferSize }));
      const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1] : null;
      return {
        navigation: nav ? {
          type: nav.type,
          ttfb: Math.round(nav.responseStart - nav.requestStart),
          dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
          tcp: Math.round(nav.connectEnd - nav.connectStart),
          domInteractive: Math.round(nav.domInteractive),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          load: Math.round(nav.loadEventEnd),
          transferSize: nav.transferSize,
          encodedBodySize: nav.encodedBodySize,
          decodedBodySize: nav.decodedBodySize
        } : null,
        paint: paints,
        largestContentfulPaint: lcp ? { time: Math.round(lcp.startTime), size: lcp.size, element: lcp.element ? lcp.element.tagName : null } : null,
        cumulativeLayoutShift: Number(shifts.filter((s: any) => !s.hadRecentInput).reduce((a: number, s: any) => a + s.value, 0).toFixed(4)),
        longTasks: { count: longTasks.length, totalDuration: Math.round(longTasks.reduce((a, t) => a + t.duration, 0)) },
        resources: { count: resources.length, byType, slowest }
      };
    });
  } catch (e) {
    warn(`Failed to read performance timing: ${(e as Error).message}`);
  }

  if (ctx.reason !== 'click') {
    try {
      result.tracePath = await recordTrace(ctx, traceMs);
    } catch (e) {
      warn(`Failed to collect performance trace: ${(e as Error).message}`);
    }
  }

  return result;
}
