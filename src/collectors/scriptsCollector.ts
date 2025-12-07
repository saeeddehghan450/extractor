/**
 * scriptsCollector.ts
 * 
 * Collect all JS (inline and external) from the page.
 * Download external files and attempt to decode sourcemaps.
 */

import { Page } from 'playwright';
import { saveSourceFile } from '../utils/fileUtils';
import { debug, warn } from '../utils/logger';

export interface ScriptsInfo {
  scripts: string[];
  inlineCount: number;
}

/**
 * Collect script information from the DOM
 */
export async function collectScripts(page: Page): Promise<ScriptsInfo> {
  const scriptsInfo: ScriptsInfo = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => (s as HTMLScriptElement).src);
    const inlineCount = Array.from(document.querySelectorAll('script:not([src])')).length;
    return { scripts, inlineCount };
  });

  debug(`External scripts count: ${scriptsInfo.scripts.length}, inline: ${scriptsInfo.inlineCount}`);

  // Download external scripts without navigating the page (use request API)
  for (const src of scriptsInfo.scripts) {
    try {
      // Use the page's request context to fetch the resource so we don't navigate
      const resp = await page.request.get(src).catch(() => null);
      if (resp) {
        const txt = await resp.text().catch(() => null);
        if (txt) {
          saveSourceFile('output/sources', src, txt, 'js');
          debug(`Script saved: ${src}`);
        }
      }
    } catch (e) {
      warn(`Failed to download script ${src}: ${(e as Error).message}`);
    }
  }

  return scriptsInfo;
}
