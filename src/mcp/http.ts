/**
 * http.ts (MCP)
 *
 * Streamable HTTP transport in stateless mode: every POST gets a fresh MCP server + transport.
 * The browser session itself lives in the shared controller, so it persists across requests.
 */

import http from 'http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { error } from '../utils/logger';

export async function handleMcpHttp(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): Promise<void> {
  if (req.method !== 'POST') {
    // stateless server: no server-initiated streams and no sessions to delete
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
    return;
  }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    error(`MCP request failed: ${(e as Error).message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
    }
  }
}
