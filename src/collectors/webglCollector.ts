/**
 * webglCollector.ts
 * Collects WebGL/canvas rendering details from the page.
 */
import { Page } from 'playwright';
import { debug, warn } from '../utils/logger';

export async function collectWebGLDetails(page: Page): Promise<any> {
  try {
    const details = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      return canvases.map((canvas: any) => {
        const ctx = canvas.getContext('webgl') || canvas.getContext('webgl2');
        if (!ctx) return { webgl: false };
        return {
          webgl: true,
          width: canvas.width,
          height: canvas.height,
          contextType: ctx instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
          extensions: ctx.getSupportedExtensions ? ctx.getSupportedExtensions() : [],
        };
      });
    });
    debug('WebGL/canvas details collected');
    return details;
  } catch (e) {
    warn(`Failed to collect WebGL/canvas details: ${(e as Error).message}`);
    return null;
  }
}
