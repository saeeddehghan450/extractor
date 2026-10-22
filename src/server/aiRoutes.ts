/**
 * aiRoutes.ts
 *
 * Machine-facing endpoints of the dashboard server:
 *   POST /mcp                 MCP over Streamable HTTP
 *   GET  /v1/tools            tool definitions (?format=openai|anthropic, default openai)
 *   POST /v1/tools/call       execute tool calls returned by a model (OpenAI or Anthropic shape)
 *   POST /v1/tools/{name}     execute one tool with a plain JSON arguments object
 *   GET  /api/agent/config    resolved agent settings (never the API key)
 *   POST /api/agent/chat      run the built-in agent, streaming NDJSON events
 *   POST /api/agent/reset     forget a conversation
 */

import http from 'http';
import { randomUUID } from 'crypto';
import { handleMcpHttp } from '../mcp/http';
import { executeToolCalls, toolDefinitions, ToolFormat } from '../ai/gateway';
import { TOOLS, callTool } from '../ai/tools';
import { AgentConfig, AgentEvent, ExtractorAgent, resolveAgentConfig } from '../ai/agent';

export class RouteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Optional bearer token for /mcp and /v1 (EXTRACTOR_API_TOKEN). */
export function checkToken(req: http.IncomingMessage): void {
  const token = process.env.EXTRACTOR_API_TOKEN;
  if (!token) return;
  const header = req.headers.authorization || '';
  if (header !== `Bearer ${token}`) throw new RouteError(401, 'Missing or invalid bearer token');
}

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

// --- agent conversations (in memory) -------------------------------------------------

interface Conversation {
  agent: ExtractorAgent;
  key: string;
  busy: boolean;
  lastUsed: number;
}
const conversations = new Map<string, Conversation>();
const MAX_CONVERSATIONS = 20;

function configKey(c: AgentConfig): string {
  return JSON.stringify([c.provider, c.model, c.baseURL || '', c.apiKey ? 'k:' + c.apiKey.slice(-6) : '', c.effort || '', c.vision, c.maxSteps]);
}

function conversationFor(id: string, opts: Partial<AgentConfig>): Conversation {
  const cfg = resolveAgentConfig(opts);
  const key = configKey(cfg);
  let conv = conversations.get(id);
  if (!conv || conv.key !== key) {
    // a new model / endpoint starts a new conversation
    conv = { agent: new ExtractorAgent(cfg), key, busy: false, lastUsed: Date.now() };
    conversations.set(id, conv);
    if (conversations.size > MAX_CONVERSATIONS) {
      const oldest = [...conversations.entries()].filter(([, c]) => !c.busy).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) conversations.delete(oldest[0]);
    }
  }
  conv.lastUsed = Date.now();
  return conv;
}

function agentOptions(body: any): Partial<AgentConfig> {
  const o: Partial<AgentConfig> = {};
  if (body.provider === 'openai' || body.provider === 'anthropic') o.provider = body.provider;
  if (typeof body.model === 'string' && body.model.trim()) o.model = body.model.trim();
  if (typeof body.baseURL === 'string' && body.baseURL.trim()) o.baseURL = body.baseURL.trim();
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) o.apiKey = body.apiKey.trim();
  if (typeof body.effort === 'string') o.effort = body.effort;
  if (typeof body.vision === 'boolean') o.vision = body.vision;
  if (typeof body.maxSteps === 'number') o.maxSteps = body.maxSteps;
  return o;
}

/**
 * Handles the routes above. Returns false when the path is not one of them.
 * `readBody` is the server's JSON body reader.
 */
export async function handleAiRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  readBody: (req: http.IncomingMessage) => Promise<any>
): Promise<boolean> {
  const p = url.pathname;
  const method = req.method || 'GET';

  if (p === '/mcp') {
    checkToken(req);
    const body = method === 'POST' ? await readBody(req) : undefined;
    await handleMcpHttp(req, res, body);
    return true;
  }

  if (p === '/v1/tools' && method === 'GET') {
    checkToken(req);
    const format: ToolFormat = url.searchParams.get('format') === 'anthropic' ? 'anthropic' : 'openai';
    sendJSON(res, 200, { format, tools: toolDefinitions(format) });
    return true;
  }

  if (p === '/v1/tools/call' && method === 'POST') {
    checkToken(req);
    const f = url.searchParams.get('format');
    const result = await executeToolCalls(await readBody(req), f === 'anthropic' || f === 'openai' ? f : undefined);
    sendJSON(res, 200, result);
    return true;
  }

  const single = p.match(/^\/v1\/tools\/([a-z0-9_]+)$/);
  if (single && method === 'POST') {
    checkToken(req);
    if (!TOOLS.some(t => t.name === single[1])) throw new RouteError(404, `Unknown tool ${single[1]}`);
    const output = await callTool(single[1], await readBody(req));
    sendJSON(res, output.isError ? 400 : 200, output);
    return true;
  }

  if (p === '/api/agent/config' && method === 'GET') {
    let cfg: Partial<AgentConfig> & { error?: string };
    try {
      const c = resolveAgentConfig();
      cfg = { ...c, apiKey: undefined };
      (cfg as any).hasApiKey = !!c.apiKey;
    } catch (e) {
      cfg = { error: (e as Error).message };
    }
    sendJSON(res, 200, { ...cfg, tools: TOOLS.map(t => ({ name: t.name, title: t.title, readOnly: t.readOnly })) });
    return true;
  }

  if (p === '/api/agent/reset' && method === 'POST') {
    const body = await readBody(req);
    if (typeof body.conversationId === 'string') conversations.delete(body.conversationId);
    sendJSON(res, 200, { ok: true });
    return true;
  }

  if (p === '/api/agent/chat' && method === 'POST') {
    const body = await readBody(req);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw new RouteError(400, 'message is required');
    const conversationId = typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : randomUUID();
    let conv: Conversation;
    try {
      conv = conversationFor(conversationId, agentOptions(body));
    } catch (e) {
      throw new RouteError(400, (e as Error).message);
    }
    if (conv.busy) throw new RouteError(409, 'This conversation is still answering');

    conv.busy = true;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Conversation-Id': conversationId });
    const write = (e: AgentEvent | { type: 'start'; conversationId: string; provider: string; model: string }) => {
      if (!res.writableEnded) res.write(JSON.stringify(e) + '\n');
    };
    write({ type: 'start', conversationId, provider: conv.agent.config.provider, model: conv.agent.config.model });
    try {
      await conv.agent.chat(message, write);
    } catch {
      // the error event was already written
    } finally {
      conv.busy = false;
      res.end();
    }
    return true;
  }

  return false;
}
