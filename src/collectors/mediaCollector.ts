/**
 * mediaCollector.ts
 * Collects audio/video playback stats from the page.
 */

import { CollectorContext } from '../types';
import { debug, warn } from '../utils/logger';

export async function collectMediaStats(ctx: CollectorContext): Promise<any> {
  try {
    const stats = await ctx.page.evaluate(() => {
      const mediaElements = Array.from(document.querySelectorAll('audio,video')) as HTMLMediaElement[];
      return mediaElements.map(el => {
        const video = el as HTMLVideoElement;
        const quality = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
        return {
          tag: el.tagName.toLowerCase(),
          src: el.currentSrc || el.src || null,
          sources: Array.from(el.querySelectorAll('source')).map(s => ({ src: s.src, type: s.type || null })),
          duration: Number.isFinite(el.duration) ? el.duration : null,
          currentTime: el.currentTime,
          paused: el.paused,
          ended: el.ended,
          autoplay: el.autoplay,
          loop: el.loop,
          volume: el.volume,
          muted: el.muted,
          playbackRate: el.playbackRate,
          readyState: el.readyState,
          networkState: el.networkState,
          width: el.tagName === 'VIDEO' ? video.videoWidth : null,
          height: el.tagName === 'VIDEO' ? video.videoHeight : null,
          droppedFrames: quality ? quality.droppedVideoFrames : null,
          totalFrames: quality ? quality.totalVideoFrames : null,
          error: el.error ? { code: el.error.code, message: el.error.message } : null
        };
      });
    });
    debug('Media stats collected');
    return stats;
  } catch (e) {
    warn(`Failed to collect media stats: ${(e as Error).message}`);
    return null;
  }
}
