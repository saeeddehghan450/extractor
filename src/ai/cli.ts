#!/usr/bin/env node
/**
 * cli.ts (agent)
 *
 * Let an LLM drive the extractor from the terminal.
 *   npm run agent -- "Audit https://example.com and list the security problems"
 *   npm run agent                         interactive chat
 *
 * Provider: OpenAI-compatible by default (OpenAI, Ollama, vLLM, LM Studio, OpenRouter, ...), or --provider anthropic.
 */

import readline from 'readline';
import { AgentConfig, AgentEvent, ExtractorAgent } from './agent';
import { controller } from '../core/controller';
import { closeDriver } from '../graph/neo4jClient';
import { flushSyncs, installAutoSync } from '../graph/sync';

const HELP = `DevTools Extractor agent

Usage:
  npm run agent -- [options] "task"      run one task
  npm run agent -- [options]             interactive chat (type "exit" to quit)

Options:
  --provider openai|anthropic   default: openai (any OpenAI-compatible API)
  --model <name>                e.g. a model served by your endpoint; anthropic default: claude-opus-5-5
  --base-url <url>              OpenAI-compatible endpoint, e.g. http://localhost:11434/v1 (Ollama)
  --max-steps <n>               model calls per message (default 30)
  --effort <level>              anthropic: low | medium | high | xhigh | max
  --no-vision                   do not send screenshots to the model
  --no-fallbacks                anthropic: disable server-side refusal fallback
  --keep-session                leave a running session open at the end

Environment:
  OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL          (provider openai)
  ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL (provider anthropic)
  EXTRACTOR_AI_PROVIDER, EXTRACTOR_AI_MODEL, EXTRACTOR_AI_BASE_URL, EXTRACTOR_AI_API_KEY (either)`;

function parseArgs(argv: string[]) {
  const opts: Partial<AgentConfig> = {};
  const rest: string[] = [];
  let keepSession = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') opts.provider = argv[++i] as AgentConfig['provider'];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--base-url') opts.baseURL = argv[++i];
    else if (a === '--max-steps') opts.maxSteps = Number(argv[++i]);
    else if (a === '--effort') opts.effort = argv[++i] as AgentConfig['effort'];
    else if (a === '--no-vision') opts.vision = false;
    else if (a === '--no-fallbacks') opts.fallbacks = false;
    else if (a === '--keep-session') keepSession = true;
    else if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else rest.push(a);
  }
  return { opts, task: rest.join(' ').trim(), keepSession };
}

const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const cyan = (s: string) => (process.stdout.isTTY ? `\x1b[36m${s}\x1b[0m` : s);
const red = (s: string) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);

function printEvent(e: AgentEvent) {
  switch (e.type) {
    case 'text': console.log(`\n${e.text}\n`); break;
    case 'tool_call': console.log(cyan(`→ ${e.name}`) + dim(` ${JSON.stringify(e.args)}`)); break;
    case 'tool_result': {
      const first = e.text.split('\n').slice(0, 3).join(' ').slice(0, 160);
      console.log((e.isError ? red('  ✗ ') : dim('  ✓ ')) + dim(first + (e.images ? ` [+${e.images} image]` : '')));
      break;
    }
    case 'error': console.error(red(`! ${e.message}`)); break;
    case 'done': console.log(dim(`(${e.steps} step${e.steps === 1 ? '' : 's'})`)); break;
  }
}

async function main() {
  installAutoSync();
  const { opts, task, keepSession } = parseArgs(process.argv.slice(2));
  let agent: ExtractorAgent;
  try {
    agent = new ExtractorAgent(opts);
  } catch (e) {
    console.error(red((e as Error).message));
    console.error('\nRun with --help for the options.');
    process.exit(1);
  }
  const { provider, model, baseURL } = agent.config;
  console.log(dim(`Model: ${provider} / ${model}${baseURL ? ` @ ${baseURL}` : ''}`));

  const finish = async (code: number) => {
    if (!keepSession) await controller.stopIfActive().catch(() => undefined);
    await flushSyncs().catch(() => undefined);
    await closeDriver();
    process.exit(code);
  };
  process.on('SIGINT', () => void finish(130));

  if (task) {
    try {
      await agent.chat(task, printEvent);
      await finish(0);
    } catch {
      await finish(1);
    }
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => rl.question(cyan('\nyou › '), async line => {
    const text = line.trim();
    if (!text) return ask();
    if (text === 'exit' || text === 'quit') { rl.close(); return finish(0); }
    try { await agent.chat(text, printEvent); } catch { /* printed */ }
    ask();
  });
  console.log(dim('Ask anything about a website, e.g. "open https://example.com and check its security headers". Type exit to quit.'));
  ask();
}

void main();
