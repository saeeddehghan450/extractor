'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/format';
import { t } from '@/lib/i18n';
import type { AgentEvent, Provider, ServerAgentConfig } from '@/lib/types';
import { copyText, toast, useHeader } from '@/lib/ui';

interface AgentSettings {
  provider: Provider;
  model: string;
  baseURL: string;
  apiKey: string;
  effort: string;
  vision: boolean;
  rememberKey: boolean;
}

const STORE_KEY = 'dx-agent';

function loadSettings(): AgentSettings {
  let saved: Partial<AgentSettings> = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as Partial<AgentSettings>; } catch { /* storage blocked */ }
  return {
    provider: saved.provider || 'openai',
    model: saved.model || '',
    baseURL: saved.baseURL || '',
    apiKey: saved.apiKey || '',
    effort: saved.effort || '',
    vision: saved.vision ?? true,
    rememberKey: saved.rememberKey ?? false
  };
}

function storeSettings(s: AgentSettings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, apiKey: s.rememberKey ? s.apiKey : '' }));
  } catch { /* storage blocked */ }
}

/** Minimal markdown: code blocks, inline code, bold, headings, bullets and line breaks (text only, no HTML). */
function Markdown({ text }: { text: string }) {
  const parts = text.split(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) return <pre key={i} className="code">{part}</pre>;
        return part.split('\n').map((line, j, all) => {
          const heading = /^#{1,4} (.+)$/.exec(line);
          const bullet = /^[-*] (.+)$/.exec(line);
          const content = heading ? heading[1] : bullet ? bullet[1] : line;
          const inline: ReactNode[] = content.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((seg, k) => {
            if (/^`[^`]+`$/.test(seg)) return <code key={k}>{seg.slice(1, -1)}</code>;
            if (/^\*\*[^*]+\*\*$/.test(seg)) return <strong key={k}>{seg.slice(2, -2)}</strong>;
            return seg;
          });
          return (
            <span key={`${i}-${j}`}>
              {heading ? <strong>{inline}</strong> : bullet ? <>• {inline}</> : inline}
              {j < all.length - 1 && <br />}
            </span>
          );
        });
      })}
    </>
  );
}

type Message =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; args: unknown; result?: { text: string; isError: boolean; images: number } }
  | { kind: 'error'; text: string }
  | { kind: 'done'; steps: number };

export function AssistantView() {
  useHeader(t('ai.title'), t('ai.subtitle'));
  const [tab, setTab] = useState<'chat' | 'connect'>('chat');
  const [serverCfg, setServerCfg] = useState<ServerAgentConfig | null>(null);
  const [settings, setSettingsState] = useState<AgentSettings>(() => loadSettings());
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const conversation = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const setSettings = (patch: Partial<AgentSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettingsState(next);
    storeSettings(next);
  };

  useEffect(() => {
    api.agentConfig().then(setServerCfg).catch(() => undefined);
    // a question handed over by another page (graph, storage, session detail)
    let asked: string | null = null;
    try { asked = sessionStorage.getItem('dx-ask'); sessionStorage.removeItem('dx-ask'); } catch { /* storage blocked */ }
    if (asked) void send(asked);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages, busy]);

  const send = async (message: string) => {
    if (!message.trim() || abort.current) return;
    const s = settingsRef.current;
    setBusy(true);
    setMessages(m => [...m, { kind: 'user', text: message }]);
    const controller = new AbortController();
    abort.current = controller;
    const handle = (ev: AgentEvent) => {
      switch (ev.type) {
        case 'start': conversation.current = ev.conversationId; break;
        case 'text': setMessages(m => [...m, { kind: 'assistant', text: ev.text }]); break;
        case 'tool_call': setMessages(m => [...m, { kind: 'tool', id: ev.id, name: ev.name, args: ev.args }]); break;
        case 'tool_result':
          setMessages(m => m.map(x => (x.kind === 'tool' && x.id === ev.id ? { ...x, result: { text: ev.text, isError: ev.isError, images: ev.images } } : x)));
          if (ev.name === 'extractor_start_session' || ev.name === 'extractor_stop_session') toast(t('ai.sessionChanged'), 'info', 2500);
          break;
        case 'error': setMessages(m => [...m, { kind: 'error', text: ev.message }]); break;
        case 'done': setMessages(m => [...m, { kind: 'done', steps: ev.steps }]); break;
      }
    };
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: conversation.current,
          message,
          provider: s.provider,
          model: s.model || undefined,
          baseURL: s.baseURL || undefined,
          apiKey: s.apiKey || undefined,
          effort: s.effort || undefined,
          vision: s.vision
        })
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error || res.statusText);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) handle(JSON.parse(line) as AgentEvent);
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setMessages(m => [...m, { kind: 'error', text: errMsg(err) }]);
    } finally {
      abort.current = null;
      setBusy(false);
      textarea.current?.focus();
    }
  };

  const newConversation = () => {
    if (busy) { abort.current?.abort(); return; }
    if (conversation.current) void api.agentReset(conversation.current).catch(() => undefined);
    conversation.current = null;
    setMessages([]);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void send(text);
  };

  return (
    <>
      <div className="tabs" id="aiTabs">
        <button data-tab="chat" className={tab === 'chat' ? 'active' : ''} onClick={() => !busy && setTab('chat')}><Icon name="zap" />{t('ai.tab.chat')}</button>
        <button data-tab="connect" className={tab === 'connect' ? 'active' : ''} onClick={() => !busy && setTab('connect')}><Icon name="network" />{t('ai.tab.connect')}</button>
      </div>
      <div id="aiPanel">
        {tab === 'chat' ? (
          <div className="ai-layout">
            <div className="card ai-chat">
              <div className="ai-messages" id="aiMessages" ref={box}>
                {!messages.length && !busy && (
                  <div className="ai-empty" id="aiEmpty">
                    <Icon name="zap" />
                    <h3>{t('ai.empty.title')}</h3>
                    <p className="muted">{t('ai.empty.text')}</p>
                    <div className="chips">
                      {['ai.example.1', 'ai.example.2', 'ai.example.3'].map(k => (
                        <button key={k} className="chip" onClick={() => { setInput(t(k)); textarea.current?.focus(); }}>{t(k)}</button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => <ChatMessage key={i} message={m} />)}
                {busy && <div className="ai-msg status"><Spinner /><span>{t('ai.thinking')}</span></div>}
              </div>
              <form className="ai-input" id="aiForm" onSubmit={submit}>
                <textarea className="input textarea" id="aiText" rows={2} ref={textarea} autoFocus placeholder={t('ai.placeholder')} value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(e); } }} />
                <div className="row">
                  <span className="muted small" id="aiModelLabel">
                    {settings.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'} · {settings.model
                      || (settings.provider === 'anthropic'
                        ? (serverCfg?.provider === 'anthropic' && serverCfg.model) || 'claude-opus-5-5'
                        : (serverCfg?.provider === 'openai' && serverCfg.model) || '—')}
                  </span>
                  <span className="spacer" />
                  <button className="btn sm ghost" type="button" id="aiNew" onClick={newConversation}>
                    {busy ? <><Icon name="stop" />{t('ai.stop')}</> : <><Icon name="refresh" />{t('ai.new')}</>}
                  </button>
                  <button className="btn primary" type="submit" id="aiSend" disabled={busy}><Icon name="play" />{t('ai.send')}</button>
                </div>
              </form>
            </div>
            <AgentSettingsCard settings={settings} serverCfg={serverCfg} busy={busy}
              onChange={patch => {
                // a new provider starts a new conversation
                if (patch.provider && patch.provider !== settings.provider) {
                  conversation.current = null;
                  setSettings({ ...patch, model: '', baseURL: '' });
                } else setSettings(patch);
              }} />
          </div>
        ) : <ConnectPanel serverCfg={serverCfg} />}
      </div>
    </>
  );
}

function ChatMessage({ message: m }: { message: Message }) {
  switch (m.kind) {
    case 'user': return <div className="ai-msg user"><div className="bubble">{m.text.split('\n').map((l, i, a) => <span key={i}>{l}{i < a.length - 1 && <br />}</span>)}</div></div>;
    case 'assistant': return <div className="ai-msg assistant"><div className="bubble"><Markdown text={m.text} /></div></div>;
    case 'error': return <div className="ai-msg error"><Icon name="alert" /><span>{m.text}</span></div>;
    case 'done': return <div className="ai-msg status muted small">{t('ai.done', { n: m.steps })}</div>;
    case 'tool':
      return (
        <details className={`ai-tool ${m.result ? (m.result.isError ? 'err' : 'ok') : ''}`}>
          <summary>
            {m.result ? <span className="ai-tool-state">{m.result.isError ? '✗' : '✓'}</span> : <Spinner />}
            <code>{m.name}</code><span className="muted small ltr truncate">{JSON.stringify(m.args)}</span>
          </summary>
          <pre className="code">{JSON.stringify(m.args, null, 2)}</pre>
          {m.result && <pre className="code result">{m.result.text}{m.result.images ? `\n[+${m.result.images} image]` : ''}</pre>}
        </details>
      );
  }
}

function AgentSettingsCard({ settings: s, serverCfg, busy, onChange }: {
  settings: AgentSettings; serverCfg: ServerAgentConfig | null; busy: boolean; onChange: (p: Partial<AgentSettings>) => void;
}) {
  const isAnthropic = s.provider === 'anthropic';
  let info = '';
  if (serverCfg?.error && !s.model) info = t('ai.noServerModel');
  else if (serverCfg && !serverCfg.error) info = t('ai.serverDefaults', { provider: serverCfg.provider || '', model: serverCfg.model || '', key: serverCfg.hasApiKey ? t('ins.yes') : t('ins.no') });
  return (
    <div className="card ai-settings">
      <div className="card-head"><Icon name="settings" /><h3>{t('ai.settings')}</h3></div>
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label>{t('ai.provider')}</label>
          <div className="seg" id="aiProvider">
            <button type="button" className={!isAnthropic ? 'active' : ''} disabled={busy} onClick={() => onChange({ provider: 'openai' })}>{t('ai.provider.openai')}</button>
            <button type="button" className={isAnthropic ? 'active' : ''} disabled={busy} onClick={() => onChange({ provider: 'anthropic' })}>Anthropic</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="aiModel">{t('ai.model')}</label>
          <input className="input ltr" id="aiModel" spellCheck={false} value={s.model} onChange={e => onChange({ model: e.target.value.trim() })}
            placeholder={isAnthropic ? 'claude-opus-5-5' : t('ai.model.placeholder')} />
        </div>
        <div className="field">
          <label htmlFor="aiBase">{t('ai.baseUrl')}</label>
          <input className="input ltr" id="aiBase" spellCheck={false} value={s.baseURL} onChange={e => onChange({ baseURL: e.target.value.trim() })}
            placeholder={isAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'} />
          <span className="hint">{isAnthropic ? t('ai.baseUrl.hint.anthropic') : t('ai.baseUrl.hint.openai')}</span>
        </div>
        <div className="field">
          <label htmlFor="aiKey">{t('ai.apiKey')}</label>
          <input className="input ltr" id="aiKey" type="password" autoComplete="off" value={s.apiKey} onChange={e => onChange({ apiKey: e.target.value.trim() })} placeholder={t('ai.apiKey.placeholder')} />
          <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" id="aiRemember" checked={s.rememberKey} onChange={e => onChange({ rememberKey: e.target.checked })} />{t('ai.apiKey.remember')}
          </label>
        </div>
        {isAnthropic && (
          <div className="field">
            <label htmlFor="aiEffort">{t('ai.effort')}</label>
            <select className="select" id="aiEffort" value={s.effort} onChange={e => onChange({ effort: e.target.value })}>
              {['', 'low', 'medium', 'high', 'xhigh', 'max'].map(v => <option key={v} value={v}>{v || t('ai.effort.auto')}</option>)}
            </select>
          </div>
        )}
        <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" id="aiVision" checked={s.vision} onChange={e => onChange({ vision: e.target.checked })} />{t('ai.vision')}
        </label>
        <p className="hint" id="aiServerCfg">{info}</p>
      </div>
    </div>
  );
}

function Snippet({ title, code, hint }: { title: string; code: string; hint?: string }) {
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3><span className="spacer" /><button className="btn sm ghost" onClick={() => copyText(code)}><Icon name="copy" />{t('common.copy')}</button></div>
      {hint && <p className="muted small" style={{ marginTop: 0 }}>{hint}</p>}
      <pre className="code">{code}</pre>
    </div>
  );
}

function ConnectPanel({ serverCfg }: { serverCfg: ServerAgentConfig | null }) {
  const origin = typeof location === 'undefined' ? '' : location.origin;
  const mcpUrl = `${origin}/mcp`;
  const stdioConfig = JSON.stringify({ mcpServers: { 'devtools-extractor': { command: 'node', args: ['/path/to/extractor/dist/mcp/main.js'] } } }, null, 2);
  const httpConfig = JSON.stringify({ mcpServers: { 'devtools-extractor': { url: mcpUrl } } }, null, 2);
  const vscodeConfig = JSON.stringify({ servers: { 'devtools-extractor': { type: 'http', url: mcpUrl } } }, null, 2);
  const dockerConfig = JSON.stringify({
    mcpServers: { 'devtools-extractor': { command: 'docker', args: ['run', '-i', '--rm', '--init', '--shm-size=1g', '-v', 'extractor-data:/data', 'devtools-extractor', 'node', 'dist/mcp/main.js'] } }
  }, null, 2);
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><Icon name="network" /><h3>{t('ai.connect.title')}</h3></div>
        <p className="muted" style={{ marginTop: 0 }}>{t('ai.connect.text')}</p>
        <div className="row"><code className="ltr" style={{ fontSize: 14 }}>{mcpUrl}</code><button className="btn sm" onClick={() => copyText(mcpUrl)}><Icon name="copy" />{t('common.copy')}</button></div>
        <div className="chips" style={{ marginTop: 12 }}>
          {(serverCfg?.tools || []).map(tl => <span key={tl.name} className={`chip ${tl.readOnly ? '' : 'on'}`} title={tl.title}>{tl.name}</span>)}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))' }}>
        <Snippet title="Claude Desktop · Cursor · Windsurf (HTTP)" code={httpConfig} hint={t('ai.connect.http')} />
        <Snippet title="Claude Desktop · Cursor · Windsurf (stdio)" code={stdioConfig} hint={t('ai.connect.stdio')} />
        <Snippet title="Claude Code" code={`claude mcp add --transport http devtools-extractor ${mcpUrl}`} />
        <Snippet title="VS Code (.vscode/mcp.json)" code={vscodeConfig} />
        <Snippet title="Codex (~/.codex/config.toml)" code={`[mcp_servers.devtools-extractor]\nurl = "${mcpUrl}"`} />
        <Snippet title="Docker (stdio)" code={dockerConfig} />
      </div>
      <div className="card">
        <div className="card-head"><Icon name="code" /><h3>{t('ai.gateway.title')}</h3></div>
        <p className="muted" style={{ marginTop: 0 }}>{t('ai.gateway.text')}</p>
        <pre className="code">{`# OpenAI function-calling tool definitions (default)
GET  ${origin}/v1/tools
# Anthropic tool definitions
GET  ${origin}/v1/tools?format=anthropic
# Run the tool calls a model returned; the response holds the messages to append
POST ${origin}/v1/tools/call      body: {"tool_calls": [...]}  or  {"content": [tool_use blocks]}
# Call one tool with plain JSON arguments
POST ${origin}/v1/tools/extractor_get_overview    body: {}`}</pre>
      </div>
    </div>
  );
}
