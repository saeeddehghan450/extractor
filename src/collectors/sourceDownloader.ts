/**
 * sourceDownloader.ts
 *
 * Downloads JS/CSS sources once per session, using the page's request context
 * (shares cookies with the browser) so the page itself is never navigated.
 */

import crypto from 'crypto';
import path from 'path';
import { CollectorContext } from '../types';
import { relPath, saveSourceFile } from '../utils/fileUtils';
import { debug, warn } from '../utils/logger';

export interface SavedSource {
  url: string;
  path: string | null;
  size: number | null;
  status: number | null;
  sourceMappingURL: string | null;
  error?: string;
}

function sourceCache(ctx: CollectorContext): Map<string, SavedSource> {
  let cache = ctx.cache.get('sources') as Map<string, SavedSource> | undefined;
  if (!cache) {
    cache = new Map();
    ctx.cache.set('sources', cache);
  }
  return cache;
}

export function findSourceMap(content: string): string | null {
  const m = content.match(/[#@]\s*sourceMappingURL=([^\s'"*]+)/);
  return m ? m[1] : null;
}

export async function downloadSource(ctx: CollectorContext, url: string, ext: 'js' | 'css'): Promise<SavedSource> {
  const cache = sourceCache(ctx);
  const cached = cache.get(url);
  if (cached) return cached;

  const entry: SavedSource = { url, path: null, size: null, status: null, sourceMappingURL: null };
  cache.set(url, entry);
  if (!/^https?:/i.test(url)) {
    entry.error = 'unsupported scheme';
    return entry;
  }
  try {
    const resp = await ctx.page.request.get(url, { timeout: 15000 });
    entry.status = resp.status();
    const txt = await resp.text();
    entry.size = Buffer.byteLength(txt);
    entry.sourceMappingURL = findSourceMap(txt);
    entry.path = relPath(ctx.sessionDir, saveSourceFile(path.join(ctx.sessionDir, 'sources'), url, txt, ext));
    debug(`Source saved: ${url}`);
  } catch (e) {
    entry.error = (e as Error).message.split('\n')[0];
    warn(`Failed to download ${url}: ${entry.error}`);
  }
  return entry;
}

/** Save inline code (deduplicated by content hash) and return its relative path. */
export function saveInline(ctx: CollectorContext, content: string, ext: 'js' | 'css'): string {
  const hash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 12);
  const key = `inline:${hash}`;
  const cache = sourceCache(ctx);
  const cached = cache.get(key);
  if (cached?.path) return cached.path;
  const file = relPath(ctx.sessionDir, saveSourceFile(path.join(ctx.sessionDir, 'sources'), `inline-${hash}`, content, ext));
  cache.set(key, { url: key, path: file, size: content.length, status: null, sourceMappingURL: findSourceMap(content) });
  return file;
}
