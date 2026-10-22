/**
 * webglCollector.ts
 * Collects canvas / WebGL details from the page.
 *
 * Calling getContext() on a canvas would create a context and could break the page,
 * so the injected page script records the context type each canvas was created with
 * (window.__extractorCanvasType) and this collector only reads that information.
 */

import { CollectorContext } from '../types';
import { debug, warn } from '../utils/logger';

export async function collectWebGLDetails(ctx: CollectorContext): Promise<any> {
  try {
    const details = await ctx.page.evaluate(() => {
      const w = window as any;
      const typeOf = (c: HTMLCanvasElement): string | null => (typeof w.__extractorCanvasType === 'function' ? w.__extractorCanvasType(c) : null);
      const canvases = Array.from(document.querySelectorAll('canvas')).map(canvas => {
        const contextType = typeOf(canvas);
        const info: any = {
          id: canvas.id || null,
          width: canvas.width,
          height: canvas.height,
          contextType,
          webgl: !!contextType && contextType.startsWith('webgl')
        };
        if (info.webgl) {
          // Same type returns the existing context - safe to call
          const gl = canvas.getContext(contextType as 'webgl') as WebGLRenderingContext | null;
          if (gl) {
            info.extensions = gl.getSupportedExtensions() || [];
            info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            info.contextLost = gl.isContextLost();
            const attrs = gl.getContextAttributes();
            info.contextAttributes = attrs;
          }
        }
        return info;
      });

      // GPU info from a throwaway canvas that is never attached to the page
      let gpu: any = null;
      try {
        const probe = document.createElement('canvas');
        const gl = (probe.getContext('webgl2') || probe.getContext('webgl')) as WebGLRenderingContext | null;
        if (gl) {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          gpu = {
            version: gl.getParameter(gl.VERSION),
            shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
            vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
            renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
          };
          (gl.getExtension('WEBGL_lose_context') as any)?.loseContext();
        }
      } catch { /* WebGL unavailable */ }

      return { canvases, gpu };
    });
    debug('WebGL/canvas details collected');
    return details;
  } catch (e) {
    warn(`Failed to collect WebGL/canvas details: ${(e as Error).message}`);
    return null;
  }
}
