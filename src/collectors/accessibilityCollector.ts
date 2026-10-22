/**
 * accessibilityCollector.ts
 * Collects the accessibility tree using CDP, plus a summary of common issues.
 */
import path from 'path';
import { CollectorContext } from '../types';
import { relPath, writeJSON } from '../utils/fileUtils';
import { debug, warn } from '../utils/logger';

const NEEDS_NAME = new Set(['button', 'link', 'image', 'img', 'checkbox', 'radio', 'textbox', 'combobox', 'menuitem', 'tab', 'switch', 'slider']);

export async function collectAccessibilityTree(ctx: CollectorContext): Promise<any> {
  if (!ctx.cdp) return null;
  try {
    const { nodes } = await ctx.cdp.send('Accessibility.getFullAXTree');
    const visible = nodes.filter(n => !n.ignored);
    const roles: Record<string, number> = {};
    const issues: any[] = [];
    const simplified = visible.map(n => {
      const role = String(n.role?.value ?? 'unknown');
      const name = String(n.name?.value ?? '');
      roles[role] = (roles[role] || 0) + 1;
      if (NEEDS_NAME.has(role) && !name.trim()) {
        issues.push({ nodeId: n.nodeId, role, issue: 'missing accessible name', backendDOMNodeId: n.backendDOMNodeId });
      }
      return { nodeId: n.nodeId, parentId: n.parentId, role, name: name.slice(0, 200) };
    });

    const treePath = path.join(ctx.sessionDir, 'accessibility', `ax-tree-${ctx.seq}.json`);
    writeJSON(treePath, nodes);
    debug('Accessibility tree collected');
    return {
      totalNodes: nodes.length,
      visibleNodes: visible.length,
      roles: Object.fromEntries(Object.entries(roles).sort((a, b) => b[1] - a[1])),
      issues: issues.slice(0, 500),
      issueCount: issues.length,
      nodes: simplified.slice(0, 3000),
      fullTreePath: relPath(ctx.sessionDir, treePath)
    };
  } catch (e) {
    warn(`Failed to collect accessibility tree: ${(e as Error).message}`);
    return null;
  }
}
