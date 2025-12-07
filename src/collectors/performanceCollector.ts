/**
 * performanceCollector.ts
 *
 * Collects Chrome DevTools Performance trace data using Playwright's CDP session.
 * Includes timeline events, CPU profiles, and frame rendering info.
 */

import { Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { debug, warn, success } from '../utils/logger';

export async function collectPerformanceTrace(page: Page, outputDir: string): Promise<string | null> {
  try {
    const client = await (page.context() as any).newCDPSession(page);
    await client.send('Tracing.start', {
      categories: [
        'devtools.timeline',
        'v8',
        'blink.user_timing',
        'loading',
        'rendering',
        'rail',
        'blink.console',
        'toplevel',
        'latencyInfo',
        'disabled-by-default-v8.cpu_profiler',
        'disabled-by-default-devtools.timeline.stack',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
      ].join(','),
      options: 'record-as-much-as-possible',
      transferMode: 'ReportEvents',
    });
    debug('Performance tracing started');

    // Wait for some activity (customize as needed)
    await page.waitForTimeout(5000);

    const traceEvents: any[] = [];
    client.on('Tracing.dataCollected', (event: any) => {
      if (event.value) traceEvents.push(...event.value);
    });

    await client.send('Tracing.end');

    const traceComplete = await new Promise<any>(resolve => {
      client.on('Tracing.tracingComplete', resolve);
    });

    const tracePath = path.join(outputDir, `performance-trace-${Date.now()}.json`);
    fs.writeFileSync(tracePath, JSON.stringify({ traceEvents }, null, 2), 'utf-8');
    success(`Performance trace saved: ${tracePath}`);
    return tracePath;
  } catch (e) {
    warn(`Failed to collect performance trace: ${(e as Error).message}`);
    return null;
  }
}
