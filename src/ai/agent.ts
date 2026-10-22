/**
 * agent.ts
 *
 * A built-in agent that lets any LLM drive the extractor's tools.
 *  - provider "openai" (default): any OpenAI-compatible Chat Completions API -
 *    OpenAI, Azure/OpenRouter/Groq/DeepSeek/Together, or local servers (Ollama, vLLM, LM Studio, llama.cpp)
 *  - provider "anthropic": the Claude Messages API
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, ToolOutput, callTool, clip } from './tools';
import { anthropicToolResult, anthropicTools, openAIImageMessage, openAITools, openAIToolMessage } from './gateway';
import { loadConfig } from '../utils/configManager';

export type Provider = 'openai' | 'anthropic';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentConfig {
  provider: Provider;
  model: string;
  baseURL?: string;
  apiKey?: string;
  /** model calls per user message */
  maxSteps: number;
  /** Anthropic only: output_config.effort */
  effort?: Effort;
  /** send screenshots to the model (needs a vision-capable model) */
  vision: boolean;
  /** Anthropic only: server-side refusal fallback on the Claude API */
  fallbacks: boolean;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; text: string; isError: boolean; images: number }
  | { type: 'done'; text: string; steps: number }
  | { type: 'error'; message: string };

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

export const AGENT_SYSTEM_PROMPT = `You are a web analysis assistant with access to DevTools Extractor, which drives a real Chromium browser and records everything Chrome DevTools can see: network traffic with bodies, console, DOM, scripts, styles, cookies and storage, security headers and TLS, performance, accessibility, media, WebGL, memory and service workers.

How to work:
- To analyse a site, call extractor_start_session with its URL. Look at the page with extractor_page_snapshot and interact with extractor_click / extractor_type using the element refs from the snapshot. Each click is recorded with a full snapshot.
- Read results with extractor_get_overview first, then drill down with extractor_list_requests, extractor_get_request, extractor_console_messages, extractor_get_collector_data and extractor_search.
- When you are done with a site, call extractor_stop_session so the results (analysis, HAR, HTML report) are saved.
- Saved sessions remain available: list them with extractor_list_sessions and pass their sessionId to the data tools.
- A Neo4j knowledge graph links every synced session: sessions, pages, domains, requests, scripts, cookies, console messages, security headers, clicks and scraped records. For questions that compare sessions or follow relationships (which third parties a site talks to, which domains several sites share, where errors come from, what scraped records link to), call extractor_graph_schema once, then use extractor_graph_insight for the common analyses or extractor_graph_query with read-only Cypher. Sessions sync when they finish; call extractor_graph_sync if the data you need is missing (e.g. for the running session). If the graph tools report that Neo4j is not configured, fall back to the session tools.

Base your answers on what the tools returned and cite concrete evidence (URLs, request ids, header names, console messages). If a tool fails, read the error and adjust instead of repeating the same call.`;

/** Explicit options > environment variables > config.json "ai" section > defaults. */
export function resolveAgentConfig(opts: Partial<AgentConfig> = {}): AgentConfig {
  const fileCfg: Partial<AgentConfig> = loadConfig().ai || {};
  const env = process.env;
  const provider: Provider = (opts.provider || env.EXTRACTOR_AI_PROVIDER || fileCfg.provider || 'openai') === 'anthropic' ? 'anthropic' : 'openai';

  const model = opts.model || env.EXTRACTOR_AI_MODEL
    || (provider === 'openai' ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL)
    || fileCfg.model
    || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : '');
  if (!model) {
    throw new Error('No model configured. Pass --model or set EXTRACTOR_AI_MODEL / OPENAI_MODEL ' +
      '(any model name your OpenAI-compatible endpoint serves, e.g. one from `ollama list` for Ollama).');
  }

  const baseURL = opts.baseURL || env.EXTRACTOR_AI_BASE_URL
    || (provider === 'openai' ? env.OPENAI_BASE_URL : env.ANTHROPIC_BASE_URL)
    || fileCfg.baseURL || undefined;
  const apiKey = opts.apiKey || env.EXTRACTOR_AI_API_KEY || (provider === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY) || undefined;
  const effortRaw = opts.effort || (env.EXTRACTOR_AI_EFFORT as Effort | undefined) || fileCfg.effort;
  const effort = effortRaw && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effortRaw) ? effortRaw : undefined;

  return {
    provider,
    model,
    baseURL,
    apiKey,
    maxSteps: Math.max(1, Math.min(200, Number(opts.maxSteps ?? env.EXTRACTOR_AI_MAX_STEPS ?? fileCfg.maxSteps ?? 30) || 30)),
    effort,
    vision: opts.vision ?? (env.EXTRACTOR_AI_VISION ? env.EXTRACTOR_AI_VISION !== '0' : fileCfg.vision ?? true),
    fallbacks: opts.fallbacks ?? (env.EXTRACTOR_AI_FALLBACKS ? env.EXTRACTOR_AI_FALLBACKS !== '0' : fileCfg.fallbacks ?? true)
  };
}

/** Models that accept output_config.effort and the "default" server-side fallback. */
const CLAUDE_5_FAMILY = /^claude-(opus|sonnet|fable|haiku|mythos)-5/;
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

async function runTools(
  calls: { id: string; name: string; args: unknown; parseError?: string }[],
  emit: (e: AgentEvent) => void
): Promise<{ id: string; name: string; output: ToolOutput }[]> {
  for (const c of calls) emit({ type: 'tool_call', id: c.id, name: c.name, args: c.args });
  // independent calls run in parallel; results keep the order of the calls
  const results = await Promise.all(calls.map(async c => ({
    id: c.id,
    name: c.name,
    output: c.parseError ? { text: c.parseError, isError: true } as ToolOutput : await callTool(c.name, c.args)
  })));
  for (const r of results) {
    emit({ type: 'tool_result', id: r.id, name: r.name, text: clip(r.output.text, 2000), isError: !!r.output.isError, images: r.output.images?.length || 0 });
  }
  return results;
}

/**
 * A conversation with one model. Call chat() for every user message; the history
 * (including tool calls and results) is kept between calls.
 */
export class ExtractorAgent {
  readonly config: AgentConfig;
  private openai?: OpenAI;
  private anthropic?: Anthropic;
  private openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  private anthropicMessages: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = resolveAgentConfig(config);
    if (this.config.provider === 'openai') {
      this.openai = new OpenAI({
        baseURL: this.config.baseURL,
        // local OpenAI-compatible servers usually need no key, but the SDK requires a value
        apiKey: this.config.apiKey || (this.config.baseURL ? 'not-needed' : undefined)
      });
      this.openaiMessages.push({ role: 'system', content: AGENT_SYSTEM_PROMPT });
    } else {
      this.anthropic = new Anthropic({
        ...(this.config.apiKey ? { apiKey: this.config.apiKey } : {}),
        ...(this.config.baseURL ? { baseURL: this.config.baseURL } : {})
      });
    }
  }

  /** Run one user message to completion. Events are delivered through `emit` as they happen. */
  async chat(userMessage: string, emit: (e: AgentEvent) => void = () => undefined): Promise<string> {
    try {
      const text = this.config.provider === 'openai'
        ? await this.chatOpenAI(userMessage, emit)
        : await this.chatAnthropic(userMessage, emit);
      return text;
    } catch (e) {
      const message = describeError(e);
      emit({ type: 'error', message });
      throw new Error(message);
    }
  }

  // --- OpenAI-compatible --------------------------------------------------------
  private async chatOpenAI(userMessage: string, emit: (e: AgentEvent) => void): Promise<string> {
    const client = this.openai!;
    const messages = this.openaiMessages;
    const tools = openAITools();
    messages.push({ role: 'user', content: userMessage });

    for (let step = 1; step <= this.config.maxSteps; step++) {
      const response = await client.chat.completions.create({
        model: this.config.model,
        messages,
        tools,
        tool_choice: 'auto'
      });
      const choice = response.choices[0];
      if (!choice) throw new Error('The model returned no choices');
      const msg = choice.message;
      const toolCalls = msg.tool_calls || [];

      messages.push({ role: 'assistant', content: msg.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      if (msg.content) emit({ type: 'text', text: msg.content });

      if (!toolCalls.length) {
        if (choice.finish_reason === 'length') emit({ type: 'error', message: 'The answer was cut off (max tokens reached).' });
        const text = msg.content || '';
        emit({ type: 'done', text, steps: step });
        return text;
      }

      const results = await runTools(toolCalls.map(c => {
        if (c.type !== 'function') return { id: c.id, name: 'custom', args: {}, parseError: 'Only function tools are supported' };
        let args: unknown = {};
        let parseError: string | undefined;
        if (c.function.arguments?.trim()) {
          try { args = JSON.parse(c.function.arguments); } catch (e) { parseError = `Invalid JSON arguments: ${(e as Error).message}`; }
        }
        return { id: c.id, name: c.function.name, args, parseError };
      }), emit);

      for (const r of results) messages.push(openAIToolMessage(r.id, r.output));
      if (this.config.vision) {
        const images = openAIImageMessage(results.map(r => ({ name: r.name, output: r.output })));
        if (images) messages.push(images);
      }
    }
    throw new Error(`Stopped after ${this.config.maxSteps} steps (raise --max-steps to allow more)`);
  }

  // --- Anthropic ------------------------------------------------------------------
  private async chatAnthropic(userMessage: string, emit: (e: AgentEvent) => void): Promise<string> {
    const client = this.anthropic!;
    const messages = this.anthropicMessages;
    const tools = anthropicTools() as Anthropic.Beta.BetaTool[];
    const isClaude5 = CLAUDE_5_FAMILY.test(this.config.model);
    // tool-heavy agent work: default to high effort on models that support it (Claude Opus 5.5 defaults to medium)
    const effort = this.config.effort || (isClaude5 ? 'high' : undefined);
    // server-side fallback is a Claude API feature; skip it for proxies / other endpoints
    const useFallbacks = this.config.fallbacks && !this.config.baseURL && FALLBACK_MODELS.has(this.config.model);
    messages.push({ role: 'user', content: userMessage });

    let finalText = '';
    for (let step = 1; step <= this.config.maxSteps; step++) {
      const response = await client.beta.messages.create({
        model: this.config.model,
        max_tokens: 16000,
        system: AGENT_SYSTEM_PROMPT,
        tools,
        messages,
        ...(effort ? { output_config: { effort } } : {}),
        ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
      });

      // keep the full content (thinking / fallback blocks must be passed back unchanged)
      messages.push({ role: 'assistant', content: response.content });

      const texts = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text);
      if (texts.length) {
        finalText = texts.join('\n');
        emit({ type: 'text', text: finalText });
      }

      if (response.stop_reason === 'refusal') {
        const category = response.stop_details?.category;
        throw new Error(`The model declined this request${category ? ` (${category})` : ''}.`);
      }
      if (response.stop_reason === 'pause_turn') continue;

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason === 'max_tokens' && toolUses.length) {
        throw new Error('A tool call was cut off (max_tokens reached); try a shorter request.');
      }
      if (!toolUses.length) {
        if (response.stop_reason === 'max_tokens') emit({ type: 'error', message: 'The answer was cut off (max tokens reached).' });
        emit({ type: 'done', text: finalText, steps: step });
        return finalText;
      }

      const results = await runTools(toolUses.map(b => ({ id: b.id, name: b.name, args: b.input })), emit);
      // every tool_result in one user message
      messages.push({
        role: 'user',
        content: results.map(r => anthropicToolResult(r.id, this.config.vision ? r.output : { ...r.output, images: undefined }))
      });
    }
    throw new Error(`Stopped after ${this.config.maxSteps} steps (raise --max-steps to allow more)`);
  }
}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic API key missing or invalid (set ANTHROPIC_API_KEY).';
  if (e instanceof Anthropic.RateLimitError) return 'Anthropic rate limit reached - try again shortly.';
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status ?? ''}: ${e.message}`;
  if (e instanceof OpenAI.AuthenticationError) return 'API key missing or invalid for the OpenAI-compatible endpoint (set OPENAI_API_KEY).';
  if (e instanceof OpenAI.RateLimitError) return 'Rate limit reached on the OpenAI-compatible endpoint - try again shortly.';
  if (e instanceof OpenAI.APIConnectionError) return `Cannot reach the model endpoint: ${e.message}`;
  if (e instanceof OpenAI.APIError) return `Model API error ${e.status ?? ''}: ${e.message}`;
  return (e as Error)?.message || String(e);
}

export const TOOL_COUNT = TOOLS.length;
