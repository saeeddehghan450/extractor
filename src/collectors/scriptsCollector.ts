/**
 * scriptsCollector.ts
 *
 * Collect all JS (inline and external) from the page.
 * External files are downloaded once per session; inline scripts are saved too.
 * sourceMappingURL comments are detected so source maps can be fetched later.
 */

import { CollectorContext } from '../types';
import { downloadSource, findSourceMap, saveInline } from './sourceDownloader';
import { debug } from '../utils/logger';

export async function collectScripts(ctx: CollectorContext): Promise<any> {
  const dom = await ctx.page.evaluate(() => ({
    external: Array.from(document.querySelectorAll('script[src]')).map(s => {
      const el = s as HTMLScriptElement;
      return { src: el.src, type: el.type || null, async: el.async, defer: el.defer, integrity: el.integrity || null, crossOrigin: el.crossOrigin };
    }),
    inline: Array.from(document.querySelectorAll('script:not([src])')).map(s => ({
      type: (s as HTMLScriptElement).type || null,
      content: s.textContent || ''
    }))
  }));

  const external = [];
  for (const s of dom.external) {
    const saved = await downloadSource(ctx, s.src, 'js');
    external.push({ ...s, savedPath: saved.path, size: saved.size, status: saved.status, sourceMappingURL: saved.sourceMappingURL, error: saved.error });
  }

  const inline = dom.inline
    .filter(s => s.content.trim().length > 0)
    .map(s => ({
      type: s.type,
      size: s.content.length,
      preview: s.content.trim().slice(0, 200),
      sourceMappingURL: findSourceMap(s.content),
      savedPath: saveInline(ctx, s.content, 'js')
    }));

  debug(`External scripts: ${external.length}, inline: ${inline.length}`);

  return {
    scripts: external.map(s => s.src),
    inlineCount: inline.length,
    external,
    inline
  };
}
