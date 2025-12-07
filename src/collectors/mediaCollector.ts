/**
 * mediaCollector.ts
 * Collects audio/video playback stats from the page.
 */

import { Page } from 'playwright';
import { debug, warn } from '../utils/logger';

export async function collectMediaStats(page: Page): Promise<any> {
  try {
    const stats = await page.evaluate(() => {
      const mediaElements = Array.from(document.querySelectorAll('audio,video'));
      return mediaElements.map((el: any) => ({
        tag: el.tagName,
        src: el.currentSrc,
        duration: el.duration,
        currentTime: el.currentTime,
        paused: el.paused,
        volume: el.volume,
        muted: el.muted,
        playbackRate: el.playbackRate,
        readyState: el.readyState,
      }));
    });
    debug('Media stats collected successfully');
    return stats;
  } catch (e) {
    warn(`Failed to collect media stats: ${(e as Error).message}`);
    return null;
  }
}
