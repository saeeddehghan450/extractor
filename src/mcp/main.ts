#!/usr/bin/env node
/**
 * main.ts (MCP)
 *
 * Standalone MCP server.
 *   stdio (default):      npm run mcp            /  node dist/mcp/main.js
 *   Streamable HTTP:      npm run mcp -- --port 8931 [--host 127.0.0.1]   ->  http://host:port/mcp
 *
 * The dashboard server (npm start) also serves MCP at /mcp, so one process can do both.
 */

import './projectRoot';
import http from 'http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server';
import { handleMcpHttp } from './http';
import { controller } from '../core/controller';
import { closeDriver } from '../graph/neo4jClient';
import { flushSyncs, installAutoSync } from '../graph/sync';
import { flushArchives, installAutoArchive } from '../storage/archive';
import { closePool } from '../storage/postgres';
import { error, info, logToStderr, success } from '../utils/logger';

function parseArgs(argv: string[]) {
  const args: { port?: number; host: string; help?: boolean } = { host: process.env.HOST || '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--host') args.host = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  if (!args.port && process.env.MCP_PORT) args.port = Number(process.env.MCP_PORT);
  return args;
}

async function shutdown(code = 0) {
  await controller.stopIfActive().catch(() => undefined);
  await Promise.all([flushSyncs(), flushArchives()]).catch(() => undefined);
  await closePool();
  await closeDriver();
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  installAutoSync();
  installAutoArchive();
  if (args.help) {
    console.log(`DevTools Extractor MCP server

  npm run mcp                         stdio transport (for MCP clients that start the server)
  npm run mcp -- --port 8931          Streamable HTTP at http://127.0.0.1:8931/mcp
  npm run mcp -- --port 8931 --host 0.0.0.0

Environment: EXTRACTOR_API_TOKEN (require "Authorization: Bearer <token>" over HTTP),
EXTRACTOR_ALLOWED_HOSTS, EXTRACTOR_HEADLESS, EXTRACTOR_CONFIG, EXTRACTOR_OUTPUT, CHROMIUM_PATH`);
    return;
  }

  if (!args.port) {
    // stdout carries JSON-RPC: every log line must go to stderr
    logToStderr();
    const server = createMcpServer();
    await server.connect(new StdioServerTransport());
    info('DevTools Extractor MCP server running on stdio');
    process.stdin.on('close', () => void shutdown(0));
  } else {
    const allowedHosts = (process.env.EXTRACTOR_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);
    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found - the MCP endpoint is /mcp' }));
        return;
      }
      const host = (req.headers.host || '').split(':')[0].toLowerCase();
      if (!allowedHosts.includes('*') && !['localhost', '127.0.0.1', '[::1]'].includes(host) && !allowedHosts.includes(host)) {
        res.writeHead(403).end('Host not allowed (set EXTRACTOR_ALLOWED_HOSTS)');
        return;
      }
      const token = process.env.EXTRACTOR_API_TOKEN;
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end('Missing or invalid bearer token');
        return;
      }
      let body: unknown;
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || 'null'); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
          return;
        }
      }
      await handleMcpHttp(req, res, body);
    });
    httpServer.listen(args.port, args.host, () => {
      success(`DevTools Extractor MCP server: http://${args.host === '0.0.0.0' ? 'localhost' : args.host}:${args.port}/mcp`);
    });
  }

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
}

main().catch(e => {
  error(`MCP server failed: ${(e as Error).message}`);
  process.exit(1);
});
