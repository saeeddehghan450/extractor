/**
 * gateway.ts
 *
 * The extractor's tools for apps that call an LLM directly instead of through MCP.
 *  - tool definitions in OpenAI function-calling format (default) or Anthropic format
 *  - execution of the tool calls a model returned, with results already shaped as the
 *    messages to append to the conversation for that provider
 */

import type OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';
import { TOOLS, ToolOutput, callTool, jsonSchemaOf } from './tools';

export type ToolFormat = 'openai' | 'anthropic';

export function openAITools(): OpenAI.Chat.Completions.ChatCompletionFunctionTool[] {
  return TOOLS.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: jsonSchemaOf(t) }
  }));
}

export function anthropicTools(): Anthropic.Tool[] {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: jsonSchemaOf(t) as Anthropic.Tool.InputSchema
  }));
}

export function toolDefinitions(format: ToolFormat) {
  return format === 'anthropic' ? anthropicTools() : openAITools();
}

// ---------------------------------------------------------------------------
// results -> provider messages
// ---------------------------------------------------------------------------

/** Tool-role message for OpenAI. Tool messages carry text only. */
export function openAIToolMessage(id: string, o: ToolOutput): OpenAI.Chat.Completions.ChatCompletionToolMessageParam {
  return { role: 'tool', tool_call_id: id, content: o.isError ? `ERROR: ${o.text}` : o.text };
}

/**
 * Chat Completions tool messages cannot hold images, so screenshots are sent in a user message
 * right after the tool messages (works with vision-capable models).
 */
export function openAIImageMessage(outputs: { name: string; output: ToolOutput }[]): OpenAI.Chat.Completions.ChatCompletionUserMessageParam | null {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  for (const { name, output } of outputs) {
    for (const img of output.images || []) {
      parts.push({ type: 'text', text: `Image returned by ${name}:` });
      parts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
    }
  }
  return parts.length ? { role: 'user', content: parts } : null;
}

export function anthropicToolResult(id: string, o: ToolOutput): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: id,
    content: [
      { type: 'text', text: o.text },
      ...(o.images || []).map(img => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mimeType, data: img.data }
      }))
    ],
    ...(o.isError ? { is_error: true } : {})
  };
}

// ---------------------------------------------------------------------------
// executing tool calls sent by a client
// ---------------------------------------------------------------------------

interface NormalizedCall {
  id: string;
  name: string;
  args: unknown;
  parseError?: string;
}

/** Accepts the shapes models return, so clients can forward them unchanged. */
function normalizeCalls(body: any): { format: ToolFormat; calls: NormalizedCall[] } {
  const asArray = (v: any) => (Array.isArray(v) ? v : v ? [v] : []);

  // OpenAI: {tool_calls:[...]}, a whole assistant message, or a single tool call
  const openaiCalls = asArray(body?.tool_calls ?? body?.choices?.[0]?.message?.tool_calls ?? (body?.function ? body : null));
  if (openaiCalls.length) {
    return {
      format: 'openai',
      calls: openaiCalls.map((c: any, i: number) => {
        let args: unknown = {};
        let parseError: string | undefined;
        const raw = c?.function?.arguments;
        if (typeof raw === 'string' && raw.trim()) {
          try { args = JSON.parse(raw); } catch (e) { parseError = `arguments are not valid JSON: ${(e as Error).message}`; }
        } else if (raw && typeof raw === 'object') {
          args = raw;
        }
        return { id: String(c?.id ?? `call_${i}`), name: String(c?.function?.name ?? ''), args, parseError };
      })
    };
  }

  // Anthropic: a whole message ({content:[...]}), a list of blocks, or a single tool_use block
  const blocks = asArray(body?.content ?? (Array.isArray(body) ? body : body?.type === 'tool_use' ? body : null))
    .filter((b: any) => b?.type === 'tool_use');
  if (blocks.length) {
    return {
      format: 'anthropic',
      calls: blocks.map((b: any, i: number) => ({ id: String(b.id ?? `toolu_${i}`), name: String(b.name ?? ''), args: b.input ?? {} }))
    };
  }
  return { format: 'openai', calls: [] };
}

export async function executeToolCalls(body: unknown, forceFormat?: ToolFormat) {
  const { format: detected, calls } = normalizeCalls(body);
  const format = forceFormat || detected;
  const results = await Promise.all(calls.map(async c => ({
    call: c,
    output: c.parseError ? { text: c.parseError, isError: true } as ToolOutput : await callTool(c.name, c.args)
  })));

  if (format === 'anthropic') {
    // one user message with every tool_result (keeps parallel tool use working)
    return {
      format,
      message: { role: 'user' as const, content: results.map(r => anthropicToolResult(r.call.id, r.output)) }
    };
  }
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = results.map(r => openAIToolMessage(r.call.id, r.output));
  const images = openAIImageMessage(results.map(r => ({ name: r.call.name, output: r.output })));
  if (images) messages.push(images);
  return { format, messages };
}

export { normalizeCalls as _normalizeCallsForTests };
