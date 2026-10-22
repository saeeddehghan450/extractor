/**
 * MCP server (in-memory, Streamable HTTP, stdio), tool gateway and the built-in agent
 * (OpenAI-compatible and Anthropic providers, against local mock model servers).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { AddressInfo } from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFixtureServer } from './fixtureSite';

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-ai-'));
process.env.EXTRACTOR_OUTPUT = outputRoot;
process.env.EXTRACTOR_CONFIG = path.join(outputRoot, 'config.json');
process.env.EXTRACTOR_HEADLESS = '1';

// loaded after the environment is set (the store reads EXTRACTOR_OUTPUT at load time)
let mod: {
  createMcpServer: typeof import('../src/mcp/server').createMcpServer;
  createServer: typeof import('../src/server/server').createServer;
  controller: typeof import('../src/core/controller').controller;
  ExtractorAgent: typeof import('../src/ai/agent').ExtractorAgent;
  TOOLS: typeof import('../src/ai/tools').TOOLS;
};
let site: { url: string; close: () => Promise<void> };

before(async () => {
  mod = {
    createMcpServer: (await import('../src/mcp/server')).createMcpServer,
    createServer: (await import('../src/server/server')).createServer,
    controller: (await import('../src/core/controller')).controller,
    ExtractorAgent: (await import('../src/ai/agent')).ExtractorAgent,
    TOOLS: (await import('../src/ai/tools')).TOOLS
  };
  site = await startFixtureServer();
});

after(async () => {
  await mod.controller.stopIfActive();
  await site.close();
  fs.rmSync(outputRoot, { recursive: true, force: true });
});

const textOf = (r: any) => (r.content as any[]).filter(c => c.type === 'text').map(c => c.text).join('\n');

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('MCP: full extraction through the tools (in-memory transport)', { timeout: 120000 }, async () => {
  const server = mod.createMcpServer();
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);

  const { tools } = await client.listTools();
  assert.equal(tools.length, mod.TOOLS.length);
  const start = tools.find(t => t.name === 'extractor_start_session')!;
  assert.ok((start.inputSchema.properties as any).device.enum.includes('iphone-15'));
  assert.equal(tools.find(t => t.name === 'extractor_get_overview')!.annotations?.readOnlyHint, true);
  assert.equal(tools.find(t => t.name === 'extractor_evaluate')!.annotations?.destructiveHint, true);

  // invalid arguments come back as a tool error, not a crash
  const bad = await client.callTool({ name: 'extractor_start_session', arguments: { url: 5 } });
  assert.equal(bad.isError, true);

  const started = await client.callTool({ name: 'extractor_start_session', arguments: { url: site.url, device: 'pixel-7' } });
  assert.ok(!started.isError, textOf(started));
  assert.match(textOf(started), /"device": "Pixel 7"/);

  const again = await client.callTool({ name: 'extractor_start_session', arguments: { url: site.url } });
  assert.equal(again.isError, true);
  assert.match(textOf(again), /already running/);

  const snap = await client.callTool({ name: 'extractor_page_snapshot', arguments: {} });
  const ref = textOf(snap).match(/button "Buy now" \[ref=(e\d+)\]/)?.[1];
  assert.ok(ref, textOf(snap));

  const snapshotDone = new Promise(resolve => mod.controller.active!.once('snapshot', resolve));
  const clicked = await client.callTool({ name: 'extractor_click', arguments: { ref, element: 'Buy now button' } });
  assert.ok(!clicked.isError, textOf(clicked));
  await snapshotDone;

  const typed = await client.callTool({ name: 'extractor_type', arguments: { role: 'textbox', value: 'me@example.com' } });
  assert.ok(!typed.isError, textOf(typed));
  const val = await client.callTool({ name: 'extractor_evaluate', arguments: { function: '() => document.querySelector("input").value' } });
  assert.match(textOf(val), /me@example.com/);

  const shot = await client.callTool({ name: 'extractor_screenshot', arguments: {} });
  assert.ok((shot.content as any[]).some(c => c.type === 'image' && c.mimeType === 'image/jpeg' && c.data.length > 1000));

  // live data
  const live = JSON.parse(textOf(await client.callTool({ name: 'extractor_list_requests', arguments: { urlContains: '/api/data' } })));
  assert.equal(live.total, 1);

  const stopped = await client.callTool({ name: 'extractor_stop_session', arguments: {} });
  assert.match(textOf(stopped), /"status": "finished"/);

  // saved data (no sessionId -> most recent saved session)
  const ov = JSON.parse(textOf(await client.callTool({ name: 'extractor_get_overview', arguments: {} })));
  assert.equal(ov.live, false);
  assert.equal(ov.page.title, 'Fixture Shop');
  assert.ok(ov.security.missingHeaders.includes('content-security-policy'));
  assert.ok(ov.consoleErrors.some((e: string) => e.includes('fixture uncaught error')));

  const reqs = JSON.parse(textOf(await client.callTool({ name: 'extractor_list_requests', arguments: { urlContains: '/api/data' } })));
  const detail = JSON.parse(textOf(await client.callTool({ name: 'extractor_get_request', arguments: { requestId: reqs.requests[0].id } })));
  assert.equal(detail.response.body, '{"message":"hello from api"}');

  const found = JSON.parse(textOf(await client.callTool({ name: 'extractor_search', arguments: { query: 'buy clicked' } })));
  assert.ok(found.matches.some((m: any) => m.kind === 'source'));

  const cons = JSON.parse(textOf(await client.callTool({ name: 'extractor_console_messages', arguments: { level: 'error' } })));
  assert.ok(cons.messages.every((m: any) => m.type === 'error'));

  const part = JSON.parse(textOf(await client.callTool({ name: 'extractor_get_collector_data', arguments: { collector: 'application', path: 'storageInfo.localStorage' } })));
  assert.equal(part.cart, '3 items');

  const exp = JSON.parse(textOf(await client.callTool({ name: 'extractor_export', arguments: { format: 'report', language: 'fa' } })));
  assert.ok(fs.readFileSync(exp.path, 'utf-8').includes('dir="rtl"'));

  const prompts = await client.listPrompts();
  assert.ok(prompts.prompts.some(p => p.name === 'audit-website'));
  await client.close();
});

test('MCP over Streamable HTTP, tool gateway, host check and token', { timeout: 60000 }, async () => {
  const server = mod.createServer();
  const base = await listen(server);
  try {
    // MCP client over HTTP
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    assert.equal(tools.length, mod.TOOLS.length);
    const list = await client.callTool({ name: 'extractor_list_sessions', arguments: { limit: 5 } });
    assert.ok(JSON.parse(textOf(list)).sessions.length >= 1);
    await client.close();

    // gateway: OpenAI format is the default
    const oai = await (await fetch(`${base}/v1/tools`)).json() as any;
    assert.equal(oai.format, 'openai');
    assert.equal(oai.tools[0].type, 'function');
    assert.equal(oai.tools[0].function.parameters.type, 'object');
    assert.equal(oai.tools[0].function.parameters.$schema, undefined);

    const ant = await (await fetch(`${base}/v1/tools?format=anthropic`)).json() as any;
    assert.ok(ant.tools[0].input_schema && ant.tools[0].name);

    const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

    // OpenAI tool calls -> tool messages
    const r1 = await (await post('/v1/tools/call', {
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'extractor_list_sessions', arguments: '{"limit":1}' } },
        { id: 'call_2', type: 'function', function: { name: 'extractor_list_sessions', arguments: '{oops' } }
      ]
    })).json() as any;
    assert.equal(r1.format, 'openai');
    assert.equal(r1.messages[0].role, 'tool');
    assert.equal(r1.messages[0].tool_call_id, 'call_1');
    assert.match(r1.messages[1].content, /^ERROR: arguments are not valid JSON/);

    // Anthropic tool_use blocks -> one user message with tool_result blocks
    const r2 = await (await post('/v1/tools/call', {
      role: 'assistant',
      content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 'toolu_1', name: 'extractor_list_sessions', input: { limit: 1 } }]
    })).json() as any;
    assert.equal(r2.format, 'anthropic');
    assert.equal(r2.message.role, 'user');
    assert.equal(r2.message.content[0].type, 'tool_result');
    assert.equal(r2.message.content[0].tool_use_id, 'toolu_1');

    // plain REST call of one tool
    const r3 = await post('/v1/tools/extractor_list_sessions', { limit: 1 });
    assert.equal(r3.status, 200);
    assert.equal((await post('/v1/tools/nope', {})).status, 404);

    // DNS rebinding protection
    const evil = await new Promise<number>(resolve => {
      http.get(`${base}/v1/tools`, { headers: { Host: 'evil.example:80' } }, res => { res.resume(); resolve(res.statusCode!); });
    });
    assert.equal(evil, 403);

    // optional bearer token
    process.env.EXTRACTOR_API_TOKEN = 'secret-token';
    try {
      assert.equal((await fetch(`${base}/v1/tools`)).status, 401);
      assert.equal((await fetch(`${base}/v1/tools`, { headers: { Authorization: 'Bearer secret-token' } })).status, 200);
      const authed = new Client({ name: 'auth', version: '1.0.0' });
      await authed.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: 'Bearer secret-token' } } }));
      assert.ok((await authed.listTools()).tools.length > 0);
      await authed.close();
    } finally {
      delete process.env.EXTRACTOR_API_TOKEN;
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('MCP over stdio (child process, clean stdout)', { timeout: 60000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', path.join(__dirname, '..', 'src', 'mcp', 'main.ts')],
    env: { ...process.env, EXTRACTOR_OUTPUT: outputRoot } as Record<string, string>,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, mod.TOOLS.length);
  const r = await client.callTool({ name: 'extractor_list_sessions', arguments: {} });
  assert.ok(JSON.parse(textOf(r)).sessions.length >= 1);
  await client.close();
});

// ---------------------------------------------------------------------------
// agent against mock model servers
// ---------------------------------------------------------------------------

function mockServer(handler: (body: any, req: http.IncomingMessage) => unknown) {
  const requests: { body: any; headers: http.IncomingHttpHeaders; path: string }[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    requests.push({ body, headers: req.headers, path: req.url || '' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(handler(body, req)));
  });
  return { server, requests };
}

test('agent: OpenAI-compatible provider runs tools and answers', { timeout: 60000 }, async () => {
  const { server, requests } = mockServer(body => {
    const last = body.messages[body.messages.length - 1];
    if (last.role === 'user') {
      return {
        id: 'c1', object: 'chat.completion', created: 0, model: body.model,
        choices: [{ index: 0, finish_reason: 'tool_calls', message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'extractor_list_sessions', arguments: '{"limit":3}' } }]
        } }]
      };
    }
    return {
      id: 'c2', object: 'chat.completion', created: 0, model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'You have saved sessions.' } }]
    };
  });
  const base = await listen(server);
  try {
    const agent = new mod.ExtractorAgent({ provider: 'openai', model: 'local-model', baseURL: `${base}/v1` });
    const events: any[] = [];
    const answer = await agent.chat('What sessions do I have?', e => events.push(e));
    assert.equal(answer, 'You have saved sessions.');
    assert.deepEqual(events.map(e => e.type), ['tool_call', 'tool_result', 'text', 'done']);
    assert.equal(events[1].isError, false);

    assert.equal(requests[0].path, '/v1/chat/completions');
    assert.equal(requests[0].body.model, 'local-model');
    assert.equal(requests[0].body.tools.length, mod.TOOLS.length);
    assert.equal(requests[0].body.tools[0].type, 'function');
    assert.equal(requests[0].body.messages[0].role, 'system');
    // second request carries the assistant tool call and the tool result
    const msgs = requests[1].body.messages;
    assert.equal(msgs[msgs.length - 2].tool_calls[0].id, 'call_a');
    assert.equal(msgs[msgs.length - 1].role, 'tool');
    assert.equal(msgs[msgs.length - 1].tool_call_id, 'call_a');
    assert.match(msgs[msgs.length - 1].content, /sessions/);
  } finally {
    server.close();
  }
});

test('agent: Anthropic provider runs tools and answers', { timeout: 60000 }, async () => {
  const { server, requests } = mockServer(body => {
    const last = body.messages[body.messages.length - 1];
    const isToolResult = Array.isArray(last.content) && last.content[0]?.type === 'tool_result';
    const base = { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
    if (!isToolResult) {
      return { ...base, stop_reason: 'tool_use', content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'toolu_x', name: 'extractor_list_sessions', input: { limit: 2 } }
      ] };
    }
    return { ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Two sessions are saved.' }] };
  });
  const base = await listen(server);
  try {
    const agent = new mod.ExtractorAgent({ provider: 'anthropic', model: 'claude-opus-5-5', baseURL: base, apiKey: 'test-key' });
    const events: any[] = [];
    const answer = await agent.chat('What sessions do I have?', e => events.push(e));
    assert.equal(answer, 'Two sessions are saved.');
    assert.deepEqual(events.map(e => e.type), ['text', 'tool_call', 'tool_result', 'text', 'done']);

    const first = requests[0];
    assert.match(first.path, /^\/v1\/messages/);
    // the SDK sends the key as x-api-key or (newer API versions) as a bearer token
    assert.ok(first.headers['x-api-key'] === 'test-key' || first.headers.authorization === 'Bearer test-key');
    assert.equal(first.body.model, 'claude-opus-5-5');
    assert.equal(first.body.tools.length, mod.TOOLS.length);
    assert.ok(first.body.tools[0].input_schema);
    assert.equal(first.body.output_config.effort, 'high');
    assert.equal(typeof first.body.system, 'string');
    // custom base URL -> no Claude-API-only fallback parameter
    assert.equal(first.body.fallbacks, undefined);

    // the assistant turn is passed back unchanged (thinking block included) and all results come in one user turn
    const msgs = requests[1].body.messages;
    assert.equal(msgs[1].role, 'assistant');
    assert.equal(msgs[1].content[0].type, 'thinking');
    assert.equal(msgs[2].role, 'user');
    assert.equal(msgs[2].content[0].type, 'tool_result');
    assert.equal(msgs[2].content[0].tool_use_id, 'toolu_x');
  } finally {
    server.close();
  }
});

test('agent: missing model for the OpenAI provider gives a clear error', () => {
  const saved = { m: process.env.OPENAI_MODEL, e: process.env.EXTRACTOR_AI_MODEL };
  delete process.env.OPENAI_MODEL;
  delete process.env.EXTRACTOR_AI_MODEL;
  try {
    assert.throws(() => new mod.ExtractorAgent({ provider: 'openai' }), /No model configured/);
  } finally {
    if (saved.m) process.env.OPENAI_MODEL = saved.m;
    if (saved.e) process.env.EXTRACTOR_AI_MODEL = saved.e;
  }
});

test('agent over the dashboard API streams NDJSON events', { timeout: 60000 }, async () => {
  const { server: llm } = mockServer(body => ({
    id: 'c', object: 'chat.completion', created: 0, model: body.model,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hello from the model.' } }]
  }));
  const llmBase = await listen(llm);
  const server = mod.createServer();
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', provider: 'openai', model: 'm', baseURL: `${llmBase}/v1` })
    });
    assert.equal(res.status, 200);
    const lines = (await res.text()).trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines[0].type, 'start');
    assert.equal(lines[0].model, 'm');
    assert.ok(lines.some(l => l.type === 'text' && l.text === 'Hello from the model.'));
    assert.equal(lines[lines.length - 1].type, 'done');

    const cfg = await (await fetch(`${base}/api/agent/config`)).json() as any;
    assert.equal(cfg.tools.length, mod.TOOLS.length);
    assert.equal(cfg.apiKey, undefined);
  } finally {
    server.closeAllConnections();
    server.close();
    llm.close();
  }
});
