/**
 * cssCollector.ts
 * 
 * Collect CSS and computed styles for the clicked element.
 * Includes:
 *  - all loaded CSS files
 *  - computed styles for a specific node
 *  - matched CSS rules
 */

import { Page } from 'playwright';
import { ClickedElementInfo } from '../types';
import { saveSourceFile } from '../utils/fileUtils';
import { debug, warn } from '../utils/logger';

export interface CSSInfo {
  loadedStylesheets: string[];
  inlineStylesCount: number;
}

/**
 * Collect all CSS of the page
 */
export async function collectCSS(page: Page, element?: ClickedElementInfo): Promise<CSSInfo> {
  const cssInfo: CSSInfo = await page.evaluate(() => {
    const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(link => (link as HTMLLinkElement).href);
    const inlineCount = Array.from(document.querySelectorAll('style')).length;
    // If you need to extract computed styles, use Object.keys or Array.from on its properties
    // Example: const computedStyles = Object.keys(window.getComputedStyle(document.body));
    return { loadedStylesheets: stylesheets, inlineStylesCount: inlineCount };
  });

  debug(`External CSS count: ${cssInfo.loadedStylesheets.length}, inline: ${cssInfo.inlineStylesCount}`);

  // Download external CSS and save
  for (const href of cssInfo.loadedStylesheets) {
    try {
      const response = await page.goto(href);
      if (response) {
        const txt = await response.text().catch(() => null);
        if (txt) {
          saveSourceFile('output/sources', href, txt, 'css');
          debug(`CSS saved: ${href}`);
        }
      }
    } catch (e) {
      warn(`Failed to download CSS ${href}: ${(e as Error).message}`);
    }
  }

  // Add computed styles for the clicked element
  if (element && element.cssSelectorGuess) {
    try {
      const computedStyles = await page.$eval(element.cssSelectorGuess, (el: HTMLElement) => {
        const styles: Record<string, string> = {};
        for (const prop of Object.keys(el.style)) {
          styles[prop] = el.style.getPropertyValue(prop);
        }
        return styles;
      });
      (element as any).computedStylesInline = computedStyles;
      debug('Computed styles for clicked element collected');
    } catch (e) {
      warn(`Failed to get computed styles for clicked element: ${(e as Error).message}`);
    }
  }

  return cssInfo;
}
