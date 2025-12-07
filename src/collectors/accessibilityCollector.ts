/**
 * accessibilityCollector.ts
 * Collects the accessibility tree using CDP.
 */
import { Page } from 'playwright';
import { debug, warn } from '../utils/logger';

export async function collectAccessibilityTree(page: Page): Promise<any> {
  try {
    const client = await (page.context() as any).newCDPSession(page);
    const tree = await client.send('Accessibility.getFullAXTree');
    debug('Accessibility tree collected');
    return tree;
  } catch (e) {
    warn(`Failed to collect accessibility tree: ${(e as Error).message}`);
    return null;
  }
}
