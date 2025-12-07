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
    const client = await (page.context() as any).newCDPSession(page);
    return client;
  } catch (e) {
    warn(`CDP session was not created: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Extract real event listeners from a node by nodeId
 */
export async function getEventListenersForNode(client: CDPSession, nodeId: number): Promise<CDPEventListener[]> {
  try {
    const res = await client.send('DOMDebugger.getEventListeners', { objectId: String(nodeId) });
    const listeners: CDPEventListener[] = (res.listeners || []).map((l: any) => ({
      type: l.type,
      useCapture: l.useCapture,
      passive: l.passive,
      once: l.once,
      handler: l.handler ? JSON.stringify(l.handler) : '',
      origin: l.origin || ''
    }));
    debug(`Extracted ${listeners.length} event listeners`);
    return listeners;
  } catch (e) {
    warn(`Failed to extract event listeners: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Resolve nodeId from a CSS selector
 */
export async function getNodeIdBySelector(client: CDPSession, selector: string): Promise<number | null> {
  try {
    const doc = await client.send('DOM.getDocument', { depth: -1 });
    const result = await client.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector
    });
    return result.nodeId || null;
  } catch (e) {
    warn(`NodeId not found for selector '${selector}': ${(e as Error).message}`);
    return null;
  }
}

/**
 * Get computed styles and matched rules for a nodeId
 */
export async function getNodeStyles(client: CDPSession, nodeId: number): Promise<any> {
  try {
    const res = await client.send('CSS.getComputedStyleForNode', { nodeId });
    const matchedRules = await client.send('CSS.getMatchedStylesForNode', { nodeId });
    return {
      computed: res.computedStyle || [],
      matchedRules: matchedRules.matchedCSSRules || []
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
