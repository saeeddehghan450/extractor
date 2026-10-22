/**
 * server.ts (MCP)
 *
 * Model Context Protocol server exposing the extractor's tools. Works with every MCP client
 * (Claude Desktop / Code, Cursor, VS Code, Codex, Windsurf, LM Studio, OpenAI and Anthropic MCP connectors, ...).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TOOLS, ToolOutput, callTool } from '../ai/tools';
import { packageVersion } from '../core/session';

export const SERVER_INSTRUCTIONS = `DevTools Extractor drives a real Chromium browser and records everything Chrome DevTools can see.
Typical flow: extractor_start_session(url) -> extractor_page_snapshot -> interact with extractor_click / extractor_type
(refs from the snapshot) -> extractor_get_overview / extractor_list_requests / extractor_search -> extractor_stop_session.
Saved sessions stay available: pass their sessionId to the data tools.`;

export function toMcpResult(o: ToolOutput): CallToolResult {
  return {
    content: [
      { type: 'text', text: o.text },
      ...(o.images || []).map(img => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType }))
    ],
    ...(o.isError ? { isError: true } : {})
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'devtools-extractor', title: 'DevTools Extractor', version: packageVersion() },
    { instructions: SERVER_INSTRUCTIONS }
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input.shape,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: !!tool.destructive,
          openWorldHint: true
        }
      },
      async (args: unknown) => toMcpResult(await callTool(tool.name, args))
    );
  }

  server.registerPrompt(
    'audit-website',
    {
      title: 'Audit a website',
      description: 'Open a site, explore it and report on security, performance, accessibility and errors.',
      argsSchema: { url: z.string().describe('Site to audit') }
    },
    ({ url }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Audit ${url} with the DevTools Extractor tools: start a session, look at the page, click through the main ` +
            'navigation, then stop the session and report the most important security, performance, accessibility and ' +
            'error findings with concrete evidence (request ids, headers, console messages).'
        }
      }]
    })
  );

  return server;
}
