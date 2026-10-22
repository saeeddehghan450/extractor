/**
 * cssCollector.ts
 *
 * Collect CSS of the page:
 *  - external stylesheets (downloaded once per session, without navigating the page)
 *  - inline <style> blocks
 *  - document.styleSheets summary (rule counts, media)
 *  - inline style of the clicked element
 */

import { CollectorContext } from '../types';
import { downloadSource, saveInline } from './sourceDownloader';
import { debug } from '../utils/logger';

export async function collectCSS(ctx: CollectorContext): Promise<any> {
  const dom = await ctx.page.evaluate(() => ({
    links: Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map(l => ({
      href: (l as HTMLLinkElement).href,
      media: (l as HTMLLinkElement).media || null
    })),
    inline: Array.from(document.querySelectorAll('style')).map(s => s.textContent || ''),
    sheets: Array.from(document.styleSheets).map(sheet => {
      let rules: number | null = null;
      try { rules = sheet.cssRules.length; } catch { rules = null; }
      return { href: sheet.href, media: sheet.media.mediaText || null, disabled: sheet.disabled, rules, crossOriginBlocked: rules === null };
    }),
    customProperties: (() => {
      const style = getComputedStyle(document.documentElement);
      const out: Record<string, string> = {};
      for (let i = 0; i < style.length; i++) {
        const name = style[i];
        if (name.startsWith('--')) out[name] = style.getPropertyValue(name).trim();
      }
      return out;
    })()
  }));

  const stylesheets = [];
  for (const l of dom.links) {
    const saved = await downloadSource(ctx, l.href, 'css');
    stylesheets.push({ ...l, savedPath: saved.path, size: saved.size, status: saved.status, error: saved.error });
  }

  const inlineStyles = dom.inline
    .filter(c => c.trim().length > 0)
    .map(c => ({ size: c.length, preview: c.trim().slice(0, 200), savedPath: saveInline(ctx, c, 'css') }));

  let clickedElementInlineStyle: Record<string, string> | null = null;
  if (ctx.click?.cssSelector) {
    clickedElementInlineStyle = await ctx.page.$eval(ctx.click.cssSelector, el => {
      const out: Record<string, string> = {};
      const s = (el as HTMLElement).style;
      for (let i = 0; i < s.length; i++) out[s[i]] = s.getPropertyValue(s[i]);
      return out;
    }).catch(() => null);
  }

  debug(`External CSS: ${stylesheets.length}, inline: ${inlineStyles.length}`);

  return {
    loadedStylesheets: stylesheets.map(s => s.href),
    inlineStylesCount: inlineStyles.length,
    stylesheets,
    inlineStyles,
    styleSheetSummary: dom.sheets,
    customProperties: dom.customProperties,
    clickedElementInlineStyle
  };
}
