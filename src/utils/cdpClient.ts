/**
 * cdpClient.ts
 *
 * Manage connection with Chrome DevTools Protocol (CDP)
 * Extract event listeners, DOM, CSS, and other advanced info
 */

import { CDPSession, Page } from 'playwright';
import { CDPEventListener } from '../types';
import { debug, warn } from './logger';

/**
 * Create a CDP session for a page
 */
export async function createCDPSession(page: Page): Promise<CDPSession | null> {
  try {
    return await page.context().newCDPSession(page);
  } catch (e) {
    warn(`CDP session was not created: ${(e as Error).message}`);
    return null;
  }
}

const enabledDomains = new WeakMap<CDPSession, Set<string>>();

/**
 * Enable CDP domains once per session (DOM must be enabled before CSS).
 */
export async function ensureDomains(client: CDPSession, domains: string[]): Promise<void> {
  let set = enabledDomains.get(client);
  if (!set) {
    set = new Set();
    enabledDomains.set(client, set);
  }
  for (const d of domains) {
    if (set.has(d)) continue;
    await client.send(`${d}.enable` as any);
    set.add(d);
  }
}

/**
 * Resolve nodeId from a CSS selector
 */
export async function getNodeIdBySelector(client: CDPSession, selector: string): Promise<number | null> {
  try {
    const doc = await client.send('DOM.getDocument', { depth: 0 });
    const result = await client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    return result.nodeId || null;
  } catch (e) {
    warn(`NodeId not found for selector '${selector}': ${(e as Error).message}`);
    return null;
  }
}

/**
 * Extract real event listeners of the element, its ancestors, document and window.
 * Click handlers are frequently delegated to an ancestor, so the whole chain matters.
 */
export async function getEventListenersForSelector(client: CDPSession, selector: string): Promise<CDPEventListener[]> {
  const out: CDPEventListener[] = [];
  try {
    const expression = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const chain = [];
      for (let n = el; n; n = n.parentNode) chain.push(n);
      chain.push(window);
      return chain;
    })()`;
    const evalRes = await client.send('Runtime.evaluate', { expression, objectGroup: 'extractor' });
    if (!evalRes.result.objectId) return out;
    const props = await client.send('Runtime.getProperties', { objectId: evalRes.result.objectId, ownProperties: true });

    const items = props.result
      .filter(p => /^\d+$/.test(p.name) && p.value?.objectId)
      .sort((a, b) => Number(a.name) - Number(b.name));

    for (const item of items) {
      const target = item.value!.description || item.value!.className || 'node';
      const res = await client.send('DOMDebugger.getEventListeners', { objectId: item.value!.objectId!, depth: 0 });
      for (const l of res.listeners || []) {
        out.push({
          target,
          type: l.type,
          useCapture: l.useCapture,
          passive: l.passive,
          once: l.once,
          scriptId: l.scriptId,
          lineNumber: l.lineNumber,
          columnNumber: l.columnNumber,
          handler: (l.handler?.description || '').slice(0, 500)
        });
      }
    }
    debug(`Extracted ${out.length} event listeners`);
  } catch (e) {
    warn(`Failed to extract event listeners: ${(e as Error).message}`);
  } finally {
    await client.send('Runtime.releaseObjectGroup', { objectGroup: 'extractor' }).catch(() => undefined);
  }
  return out;
}

/**
 * Get computed styles and matched rules for a nodeId
 */
export async function getNodeStyles(client: CDPSession, nodeId: number): Promise<any> {
  try {
    await ensureDomains(client, ['DOM', 'CSS']);
    const res = await client.send('CSS.getComputedStyleForNode', { nodeId });
    const matched = await client.send('CSS.getMatchedStylesForNode', { nodeId });
    const computed: Record<string, string> = {};
    for (const p of res.computedStyle || []) computed[p.name] = p.value;
    return {
      computed,
      inlineStyle: matched.inlineStyle?.cssText || null,
      matchedRules: (matched.matchedCSSRules || []).map(m => ({
        selector: m.rule.selectorList.text,
        origin: m.rule.origin,
        styleSheetId: m.rule.styleSheetId || null,
        cssText: m.rule.style.cssText || m.rule.style.cssProperties.map(p => `${p.name}: ${p.value}`).join('; ')
      }))
    };
  } catch (e) {
    warn(`Failed to extract CSS for nodeId ${nodeId}: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Get bounding box and box model
 */
export async function getBoxModel(client: CDPSession, nodeId: number): Promise<any> {
  try {
    const res = await client.send('DOM.getBoxModel', { nodeId });
    return res.model || null;
  } catch (e) {
    warn(`Failed to extract box model for nodeId ${nodeId}: ${(e as Error).message}`);
    return null;
  }
}
