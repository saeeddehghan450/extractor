/**
 * ai.controller.ts - machine-facing endpoints and the built-in agent
 *
 *   POST /mcp                 MCP over Streamable HTTP (stateless)
 *   GET  /v1/tools            tool definitions (?format=openai|anthropic, default openai)
 *   POST /v1/tools/call       execute tool calls returned by a model (OpenAI or Anthropic shape)
 *   POST /v1/tools/:name      execute one tool with a plain JSON arguments object
 *   GET  /api/agent/config    resolved agent settings (never the API key)
 *   POST /api/agent/chat      run the agent, streaming NDJSON events
 *   POST /api/agent/reset     forget a conversation
 *
 * /mcp and /v1 accept a bearer token when EXTRACTOR_API_TOKEN is set.
 */

import { randomUUID } from 'crypto';
import { All, BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AgentConfig, AgentEvent, resolveAgentConfig } from '../../ai/agent';
import { ToolFormat, executeToolCalls, toolDefinitions } from '../../ai/gateway';
import { TOOLS, callTool } from '../../ai/tools';
import { handleMcpHttp } from '../../mcp/http';
import { ApiTokenGuard } from '../common/security';
import { AgentService, agentOptions } from './agent.service';

@Controller()
@UseGuards(ApiTokenGuard)
export class ToolsController {
  @All('mcp')
  async mcp(@Req() req: Request, @Res() res: Response) {
    await handleMcpHttp(req, res, req.method === 'POST' ? req.body : undefined);
  }

  @Get('v1/tools')
  tools(@Query('format') format?: string) {
    const f: ToolFormat = format === 'anthropic' ? 'anthropic' : 'openai';
    return { format: f, tools: toolDefinitions(f) };
  }

  @HttpCode(200)
  @Post('v1/tools/call')
  call(@Body() body: unknown, @Query('format') format?: string) {
    return executeToolCalls(body ?? {}, format === 'anthropic' || format === 'openai' ? format : undefined);
  }

  @HttpCode(200)
  @Post('v1/tools/:name')
  async one(@Param('name') name: string, @Body() body: unknown, @Res() res: Response) {
    if (!TOOLS.some(t => t.name === name)) throw new NotFoundException(`Unknown tool ${name}`);
    const output = await callTool(name, body ?? {});
    res.status(output.isError ? 400 : 200).json(output);
  }
}

@Controller('api/agent')
export class AgentController {
  constructor(@Inject(AgentService) private readonly agents: AgentService) {}

  @Get('config')
  config() {
    let cfg: Partial<AgentConfig> & { error?: string; hasApiKey?: boolean };
    try {
      const c = resolveAgentConfig();
      cfg = { ...c, apiKey: undefined, hasApiKey: !!c.apiKey };
    } catch (e) {
      cfg = { error: (e as Error).message };
    }
    return { ...cfg, tools: TOOLS.map(t => ({ name: t.name, title: t.title, readOnly: t.readOnly })) };
  }

  @HttpCode(200)
  @Post('reset')
  reset(@Body() body: any) {
    if (typeof body?.conversationId === 'string') this.agents.reset(body.conversationId);
    return { ok: true };
  }

  @HttpCode(200)
  @Post('chat')
  async chat(@Body() body: any, @Res() res: Response) {
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) throw new BadRequestException('message is required');
    const conversationId = typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : randomUUID();
    const conv = this.agents.conversation(conversationId, agentOptions(body));
    if (conv.busy) throw new ConflictException('This conversation is still answering');

    conv.busy = true;
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Conversation-Id', conversationId);
    res.flushHeaders();
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
  }
}
