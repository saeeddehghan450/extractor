/**
 * agent.service.ts - conversations of the built-in agent (kept in memory, at most 20).
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentConfig, ExtractorAgent, resolveAgentConfig } from '../../ai/agent';

export interface Conversation {
  agent: ExtractorAgent;
  key: string;
  busy: boolean;
  lastUsed: number;
}

const MAX_CONVERSATIONS = 20;

function configKey(c: AgentConfig): string {
  return JSON.stringify([c.provider, c.model, c.baseURL || '', c.apiKey ? 'k:' + c.apiKey.slice(-6) : '', c.effort || '', c.vision, c.maxSteps]);
}

/** Agent options sent by the dashboard. */
export function agentOptions(body: any): Partial<AgentConfig> {
  const o: Partial<AgentConfig> = {};
  if (!body || typeof body !== 'object') return o;
  if (body.provider === 'openai' || body.provider === 'anthropic') o.provider = body.provider;
  if (typeof body.model === 'string' && body.model.trim()) o.model = body.model.trim();
  if (typeof body.baseURL === 'string' && body.baseURL.trim()) o.baseURL = body.baseURL.trim();
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) o.apiKey = body.apiKey.trim();
  if (typeof body.effort === 'string') o.effort = body.effort as AgentConfig['effort'];
  if (typeof body.vision === 'boolean') o.vision = body.vision;
  if (typeof body.maxSteps === 'number') o.maxSteps = body.maxSteps;
  return o;
}

@Injectable()
export class AgentService {
  private readonly conversations = new Map<string, Conversation>();

  /** The conversation with this id; a new model / endpoint starts a new conversation. */
  conversation(id: string, opts: Partial<AgentConfig>): Conversation {
    let cfg: AgentConfig;
    try {
      cfg = resolveAgentConfig(opts);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const key = configKey(cfg);
    let conv = this.conversations.get(id);
    if (!conv || conv.key !== key) {
      conv = { agent: new ExtractorAgent(cfg), key, busy: false, lastUsed: Date.now() };
      this.conversations.set(id, conv);
      if (this.conversations.size > MAX_CONVERSATIONS) {
        const oldest = [...this.conversations.entries()].filter(([, c]) => !c.busy).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        if (oldest) this.conversations.delete(oldest[0]);
      }
    }
    conv.lastUsed = Date.now();
    return conv;
  }

  reset(id: string): void {
    this.conversations.delete(id);
  }
}
