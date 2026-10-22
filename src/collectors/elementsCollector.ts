/**
 * elementsCollector.ts
 *
 * DOM information:
 *  - page overview (title, node counts, tag histogram, forms, headings, meta, iframes)
 *  - for clicks: attributes, computed styles, matched rules, box model and
 *    real event listeners (element + ancestors) from CDP
 */

import { CollectorContext } from '../types';
import { getBoxModel, getEventListenersForSelector, getNodeIdBySelector, getNodeStyles } from '../utils/cdpClient';
import { debug, warn } from '../utils/logger';

export async function collectElementInfo(ctx: CollectorContext): Promise<any> {
  const { page, cdp, click } = ctx;

  const overview = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const histogram: Record<string, number> = {};
    for (const el of all) histogram[el.tagName.toLowerCase()] = (histogram[el.tagName.toLowerCase()] || 0) + 1;
    const topTags = Object.entries(histogram).sort((a, b) => b[1] - a[1]).slice(0, 25);
    return {
      title: document.title,
      url: location.href,
      doctype: document.doctype ? document.doctype.name : null,
      lang: document.documentElement.lang || null,
      dir: document.documentElement.dir || null,
      elementCount: all.length,
      maxDepth: (() => {
        let max = 0;
        const walk = (n: Element, d: number) => { if (d > max) max = d; for (const c of Array.from(n.children)) walk(c, d + 1); };
        walk(document.documentElement, 1);
        return max;
      })(),
      tagHistogram: Object.fromEntries(topTags),
      links: document.links.length,
      images: document.images.length,
      buttons: document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').length,
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => (f as HTMLIFrameElement).src || '(inline)'),
      headings: Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 50).map(h => ({
        level: h.tagName.toLowerCase(),
        text: (h.textContent || '').trim().slice(0, 150)
      })),
      meta: Array.from(document.querySelectorAll('meta')).map(m => ({
        name: m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || (m.hasAttribute('charset') ? 'charset' : null),
        content: m.getAttribute('content') || m.getAttribute('charset')
      })).filter(m => m.name),
      forms: Array.from(document.forms).map(f => ({
        id: f.id || null,
        name: f.getAttribute('name'),
        action: f.action,
        method: (f.method || 'get').toUpperCase(),
        fields: Array.from(f.elements).slice(0, 100).map(e => ({
          tag: e.tagName.toLowerCase(),
          type: (e as HTMLInputElement).type || null,
          name: (e as HTMLInputElement).name || null,
          id: e.id || null,
          required: (e as HTMLInputElement).required || false
        }))
      }))
    };
  });

  const result: any = { overview, clickedElement: null, eventListeners: [] };

  if (!click) return result;

  const clicked: any = { ...click };
  result.clickedElement = clicked;

  const mainFrameUrl = page.mainFrame().url();
  if (click.frameUrl && click.frameUrl !== mainFrameUrl) {
    clicked.note = 'Element lives in an iframe; CDP details are only collected for the main frame.';
    return result;
  }
  if (!cdp || !click.cssSelector) {
    warn('CDP session or selector missing; skipping detailed element info');
    return result;
  }

  try {
    const nodeId = await getNodeIdBySelector(cdp, click.cssSelector);
    if (!nodeId) {
      clicked.note = 'Element is no longer in the DOM (it may have been removed after the click).';
      return result;
    }
    const outer = await cdp.send('DOM.getOuterHTML', { nodeId }).catch(() => null);
    clicked.outerHTML = outer ? outer.outerHTML.slice(0, 5000) : null;

    const styles = await getNodeStyles(cdp, nodeId);
    if (styles) {
      clicked.computedStyles = styles.computed;
      clicked.inlineStyle = styles.inlineStyle;
      clicked.matchedRules = styles.matchedRules;
    }
    clicked.boxModel = await getBoxModel(cdp, nodeId);
    result.eventListeners = await getEventListenersForSelector(cdp, click.cssSelector);
    debug(`Clicked element info collected using selector: ${click.cssSelector}`);
  } catch (e) {
    warn(`Error collecting element information: ${(e as Error).message}`);
  }

  return result;
}
