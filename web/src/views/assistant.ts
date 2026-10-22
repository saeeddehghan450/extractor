import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { $, $$, copyText, errMsg, esc, html, toast } from '../util.js';
import type { ViewContext } from '../types.js';

type Provider = 'openai' | 'anthropic';

interface AgentSettings {
  provider: Provider;
  model: string;
  baseURL: string;
  apiKey: string;
  effort: string;
  vision: boolean;
  rememberKey: boolean;
}

interface ServerAgentConfig {
  provider?: Provider;
  model?: string;
  baseURL?: string;
  hasApiKey?: boolean;
  effort?: string;
  vision?: boolean;
  error?: string;
  tools: { name: string; title: string; readOnly: boolean }[];
}

type AgentEvent =
  | { type: 'start'; conversationId: string; provider: string; model: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; text: string; isError: boolean; images: number }
  | { type: 'done'; text: string; steps: number }
  | { type: 'error'; message: string };

const STORE_KEY = 'dx-agent';

function loadSettings(): Partial<AgentSettings> {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as Partial<AgentSettings>; } catch { return {}; }
}

function saveSettings(s: AgentSettings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, apiKey: s.rememberKey ? s.apiKey : '' }));
  } catch { /* storage blocked */ }
}

/** Minimal, safe markdown: escaped text with code blocks, inline code, bold and line breaks. */
function renderMarkdown(text: string): string {
  const parts = text.split(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return `<pre class="code">${esc(part)}</pre>`;
    return esc(part)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^#{1,4} (.+)$/gm, '<strong>$1</strong>')
      .replace(/^[-*] (.+)$/gm, '• $1')
      .replace(/\n/g, '<br>');
  }).join('');
}

export function mount(el: HTMLElement, _params: string[], { setHeader }: ViewContext): () => void {
  setHeader(t('ai.title'), t('ai.subtitle'));
  let tab: 'chat' | 'connect' = 'chat';
  let conversationId: string | null = null;
  let busy = false;
  let serverCfg: ServerAgentConfig | null = null;
  let controllerAbort: AbortController | null = null;
  const saved = loadSettings();
  const settings: AgentSettings = {
    provider: saved.provider || 'openai',
    model: saved.model || '',
    baseURL: saved.baseURL || '',
    apiKey: saved.apiKey || '',
    effort: saved.effort || '',
    vision: saved.vision ?? true,
    rememberKey: saved.rememberKey ?? false
  };

  html(el, `
    <div class="tabs" id="aiTabs">
      <button data-tab="chat" class="active">${icon('zap')}${esc(t('ai.tab.chat'))}</button>
      <button data-tab="connect">${icon('network')}${esc(t('ai.tab.connect'))}</button>
    </div>
    <div id="aiPanel"></div>`);

  $('#aiTabs', el).onclick = e => {
    const b = (e.target as Element).closest<HTMLElement>('button[data-tab]');
    if (!b || busy) return;
    tab = b.dataset.tab as typeof tab;
    $$('#aiTabs button', el).forEach(x => x.classList.toggle('active', x === b));
    render();
  };

  const render = () => (tab === 'chat' ? renderChat() : renderConnect());

  // ---------------------------------------------------------------- chat
  const renderChat = () => {
    const panel = $('#aiPanel', el);
    const isAnthropic = settings.provider === 'anthropic';
    html(panel, `
      <div class="ai-layout">
        <div class="card ai-chat">
          <div class="ai-messages" id="aiMessages">
            <div class="ai-empty" id="aiEmpty">
              ${icon('zap')}
              <h3>${esc(t('ai.empty.title'))}</h3>
              <p class="muted">${esc(t('ai.empty.text'))}</p>
              <div class="chips">${['ai.example.1', 'ai.example.2', 'ai.example.3'].map(k => `<button class="chip" data-example="${esc(t(k))}">${esc(t(k))}</button>`).join('')}</div>
            </div>
          </div>
          <form class="ai-input" id="aiForm">
            <textarea class="input textarea" id="aiText" rows="2" placeholder="${esc(t('ai.placeholder'))}"></textarea>
            <div class="row">
              <span class="muted small" id="aiModelLabel"></span>
              <span class="spacer"></span>
              <button class="btn sm ghost" type="button" id="aiNew">${icon('refresh')}${esc(t('ai.new'))}</button>
              <button class="btn primary" type="submit" id="aiSend">${icon('play')}${esc(t('ai.send'))}</button>
            </div>
          </form>
        </div>

        <div class="card ai-settings">
          <div class="card-head">${icon('settings')}<h3>${esc(t('ai.settings'))}</h3></div>
          <div class="stack" style="gap:12px">
            <div class="field">
              <label>${esc(t('ai.provider'))}</label>
              <div class="seg" id="aiProvider">
                <button type="button" data-p="openai" class="${!isAnthropic ? 'active' : ''}">${esc(t('ai.provider.openai'))}</button>
                <button type="button" data-p="anthropic" class="${isAnthropic ? 'active' : ''}">Anthropic</button>
              </div>
            </div>
            <div class="field">
              <label for="aiModel">${esc(t('ai.model'))}</label>
              <input class="input ltr" id="aiModel" spellcheck="false" value="${esc(settings.model)}" placeholder="${esc(isAnthropic ? 'claude-opus-5-5' : t('ai.model.placeholder'))}">
            </div>
            <div class="field">
              <label for="aiBase">${esc(t('ai.baseUrl'))}</label>
              <input class="input ltr" id="aiBase" spellcheck="false" value="${esc(settings.baseURL)}" placeholder="${esc(isAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')}">
              <span class="hint">${esc(isAnthropic ? t('ai.baseUrl.hint.anthropic') : t('ai.baseUrl.hint.openai'))}</span>
            </div>
            <div class="field">
              <label for="aiKey">${esc(t('ai.apiKey'))}</label>
              <input class="input ltr" id="aiKey" type="password" autocomplete="off" value="${esc(settings.apiKey)}" placeholder="${esc(t('ai.apiKey.placeholder'))}">
              <label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" id="aiRemember" ${settings.rememberKey ? 'checked' : ''}>${esc(t('ai.apiKey.remember'))}</label>
            </div>
            ${isAnthropic ? `
            <div class="field">
              <label for="aiEffort">${esc(t('ai.effort'))}</label>
              <select class="select" id="aiEffort">
                ${['', 'low', 'medium', 'high', 'xhigh', 'max'].map(v => `<option value="${v}" ${settings.effort === v ? 'selected' : ''}>${v || esc(t('ai.effort.auto'))}</option>`).join('')}
              </select>
            </div>` : ''}
            <label class="row small" style="gap:8px;cursor:pointer"><input type="checkbox" id="aiVision" ${settings.vision ? 'checked' : ''}>${esc(t('ai.vision'))}</label>
            <p class="hint" id="aiServerCfg"></p>
          </div>
        </div>
      </div>`);

    const syncLabel = () => {
      const model = settings.model || (settings.provider === 'anthropic' ? (serverCfg?.provider === 'anthropic' && serverCfg.model) || 'claude-opus-5-5' : (serverCfg?.provider === 'openai' && serverCfg.model) || '—');
      $('#aiModelLabel', panel).textContent = `${settings.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'} · ${model}`;
      const info = $('#aiServerCfg', panel);
      if (serverCfg?.error && !settings.model) info.textContent = t('ai.noServerModel');
      else if (serverCfg && !serverCfg.error) {
        info.textContent = t('ai.serverDefaults', { provider: serverCfg.provider || '', model: serverCfg.model || '', key: serverCfg.hasApiKey ? t('ins.yes') : t('ins.no') });
      }
    };

    const read = () => {
      settings.model = $<HTMLInputElement>('#aiModel', panel).value.trim();
      settings.baseURL = $<HTMLInputElement>('#aiBase', panel).value.trim();
      settings.apiKey = $<HTMLInputElement>('#aiKey', panel).value.trim();
      settings.rememberKey = $<HTMLInputElement>('#aiRemember', panel).checked;
      settings.vision = $<HTMLInputElement>('#aiVision', panel).checked;
      const effort = panel.querySelector<HTMLSelectElement>('#aiEffort');
      if (effort) settings.effort = effort.value;
      saveSettings(settings);
      syncLabel();
    };
    panel.querySelectorAll('.ai-settings input, .ai-settings select').forEach(i => i.addEventListener('change', read));

    $('#aiProvider', panel).onclick = e => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-p]');
      if (!b || busy) return;
      read();
      settings.provider = b.dataset.p as Provider;
      settings.model = '';
      settings.baseURL = '';
      saveSettings(settings);
      conversationId = null;
      renderChat();
    };

    $('#aiNew', panel).onclick = () => {
      if (busy) { controllerAbort?.abort(); return; }
      if (conversationId) {
        void fetch('/api/agent/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId }) });
      }
      conversationId = null;
      renderChat();
    };

    panel.querySelector('#aiEmpty')?.addEventListener('click', e => {
      const chip = (e.target as Element).closest<HTMLElement>('[data-example]');
      if (chip) {
        $<HTMLTextAreaElement>('#aiText', panel).value = chip.dataset.example!;
        $<HTMLTextAreaElement>('#aiText', panel).focus();
      }
    });

    const textarea = $<HTMLTextAreaElement>('#aiText', panel);
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $<HTMLFormElement>('#aiForm', panel).requestSubmit();
      }
    });

    $<HTMLFormElement>('#aiForm', panel).onsubmit = async e => {
      e.preventDefault();
      read();
      const message = textarea.value.trim();
      if (!message || busy) return;
      textarea.value = '';
      await send(panel, message);
    };

    syncLabel();
    textarea.focus();
  };

  const messagesBox = (panel: HTMLElement) => $('#aiMessages', panel);

  const append = (panel: HTMLElement, markup: string): HTMLElement => {
    panel.querySelector('#aiEmpty')?.remove();
    const box = messagesBox(panel);
    const wrap = document.createElement('div');
    html(wrap, markup);
    const node = wrap.firstElementChild as HTMLElement;
    box.appendChild(node);
    box.scrollTop = box.scrollHeight;
    return node;
  };

  const send = async (panel: HTMLElement, message: string) => {
    busy = true;
    const sendBtn = $<HTMLButtonElement>('#aiSend', panel);
    sendBtn.disabled = true;
    $('#aiNew', panel).innerHTML = `${icon('stop')}${esc(t('ai.stop'))}`;
    append(panel, `<div class="ai-msg user"><div class="bubble">${esc(message).replace(/\n/g, '<br>')}</div></div>`);
    const thinking = append(panel, `<div class="ai-msg status"><span class="spinner"></span><span>${esc(t('ai.thinking'))}</span></div>`);
    const toolNodes = new Map<string, HTMLElement>();
    controllerAbort = new AbortController();

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controllerAbort.signal,
        body: JSON.stringify({
          conversationId,
          message,
          provider: settings.provider,
          model: settings.model || undefined,
          baseURL: settings.baseURL || undefined,
          apiKey: settings.apiKey || undefined,
          effort: settings.effort || undefined,
          vision: settings.vision
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
          if (!line) continue;
          const ev = JSON.parse(line) as AgentEvent;
          handleEvent(panel, ev, thinking, toolNodes);
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        append(panel, `<div class="ai-msg error">${icon('alert')}<span>${esc(errMsg(err))}</span></div>`);
      }
    } finally {
      thinking.remove();
      busy = false;
      controllerAbort = null;
      if (panel.isConnected) {
        sendBtn.disabled = false;
        $('#aiNew', panel).innerHTML = `${icon('refresh')}${esc(t('ai.new'))}`;
        $<HTMLTextAreaElement>('#aiText', panel).focus();
      }
    }
  };

  const handleEvent = (panel: HTMLElement, ev: AgentEvent, thinking: HTMLElement, tools: Map<string, HTMLElement>) => {
    const box = messagesBox(panel);
    switch (ev.type) {
      case 'start':
        conversationId = ev.conversationId;
        break;
      case 'text':
        box.insertBefore(append(panel, `<div class="ai-msg assistant"><div class="bubble">${renderMarkdown(ev.text)}</div></div>`), thinking);
        break;
      case 'tool_call': {
        const node = append(panel, `
          <details class="ai-tool">
            <summary><span class="spinner"></span><code>${esc(ev.name)}</code><span class="muted small ltr truncate">${esc(JSON.stringify(ev.args))}</span></summary>
            <pre class="code">${esc(JSON.stringify(ev.args, null, 2))}</pre>
          </details>`);
        box.insertBefore(node, thinking);
        tools.set(ev.id, node);
        break;
      }
      case 'tool_result': {
        const node = tools.get(ev.id);
        if (!node) break;
        node.classList.add(ev.isError ? 'err' : 'ok');
        node.querySelector('.spinner')?.replaceWith(Object.assign(document.createElement('span'), { className: 'ai-tool-state', textContent: ev.isError ? '✗' : '✓' }));
        node.insertAdjacentHTML('beforeend', `<pre class="code result">${esc(ev.text)}${ev.images ? `\n[+${ev.images} image]` : ''}</pre>`);
        if (ev.name === 'extractor_start_session' || ev.name === 'extractor_stop_session') toast(t('ai.sessionChanged'), 'info', 2500);
        break;
      }
      case 'error':
        box.insertBefore(append(panel, `<div class="ai-msg error">${icon('alert')}<span>${esc(ev.message)}</span></div>`), thinking);
        break;
      case 'done':
        box.insertBefore(append(panel, `<div class="ai-msg status muted small">${esc(t('ai.done', { n: ev.steps }))}</div>`), thinking);
        break;
    }
    box.scrollTop = box.scrollHeight;
  };

  // ---------------------------------------------------------------- connect
  const renderConnect = () => {
    const panel = $('#aiPanel', el);
    const origin = location.origin;
    const mcpUrl = `${origin}/mcp`;
    const snippet = (title: string, code: string, hint = '') => `
      <div class="card">
        <div class="card-head"><h3>${esc(title)}</h3><span class="spacer"></span><button class="btn sm ghost" data-copy="${esc(code)}">${icon('copy')}${esc(t('common.copy'))}</button></div>
        ${hint ? `<p class="muted small" style="margin-top:0">${esc(hint)}</p>` : ''}
        <pre class="code">${esc(code)}</pre>
      </div>`;
    const stdioConfig = JSON.stringify({
      mcpServers: { 'devtools-extractor': { command: 'node', args: ['/path/to/extractor/dist/mcp/main.js'] } }
    }, null, 2);
    const httpConfig = JSON.stringify({ mcpServers: { 'devtools-extractor': { url: mcpUrl } } }, null, 2);
    const vscodeConfig = JSON.stringify({ servers: { 'devtools-extractor': { type: 'http', url: mcpUrl } } }, null, 2);
    const dockerConfig = JSON.stringify({
      mcpServers: { 'devtools-extractor': { command: 'docker', args: ['run', '-i', '--rm', '--init', '--shm-size=1g', '-v', 'extractor-data:/data', 'devtools-extractor', 'node', 'dist/mcp/main.js'] } }
    }, null, 2);

    html(panel, `
      <div class="stack">
        <div class="card">
          <div class="card-head">${icon('network')}<h3>${esc(t('ai.connect.title'))}</h3></div>
          <p class="muted" style="margin-top:0">${esc(t('ai.connect.text'))}</p>
          <div class="row"><code class="ltr" style="font-size:14px">${esc(mcpUrl)}</code><button class="btn sm" data-copy="${esc(mcpUrl)}">${icon('copy')}${esc(t('common.copy'))}</button></div>
          <div class="chips" style="margin-top:12px">${(serverCfg?.tools || []).map(tl => `<span class="chip ${tl.readOnly ? '' : 'on'}" title="${esc(tl.title)}">${esc(tl.name)}</span>`).join('')}</div>
        </div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
          ${snippet('Claude Desktop · Cursor · Windsurf (HTTP)', httpConfig, t('ai.connect.http'))}
          ${snippet('Claude Desktop · Cursor · Windsurf (stdio)', stdioConfig, t('ai.connect.stdio'))}
          ${snippet('Claude Code', `claude mcp add --transport http devtools-extractor ${mcpUrl}`)}
          ${snippet('VS Code (.vscode/mcp.json)', vscodeConfig)}
          ${snippet('Codex (~/.codex/config.toml)', `[mcp_servers.devtools-extractor]\nurl = "${mcpUrl}"`)}
          ${snippet('Docker (stdio)', dockerConfig)}
        </div>
        <div class="card">
          <div class="card-head">${icon('code')}<h3>${esc(t('ai.gateway.title'))}</h3></div>
          <p class="muted" style="margin-top:0">${esc(t('ai.gateway.text'))}</p>
          <pre class="code">${esc(`# OpenAI function-calling tool definitions (default)
GET  ${origin}/v1/tools
# Anthropic tool definitions
GET  ${origin}/v1/tools?format=anthropic
# Run the tool calls a model returned; the response holds the messages to append
POST ${origin}/v1/tools/call      body: {"tool_calls": [...]}  or  {"content": [tool_use blocks]}
# Call one tool with plain JSON arguments
POST ${origin}/v1/tools/extractor_get_overview    body: {}`)}</pre>
        </div>
      </div>`);

    panel.onclick = e => {
      const b = (e.target as Element).closest<HTMLElement>('[data-copy]');
      if (b) void copyText(b.dataset.copy!);
    };
  };

  fetch('/api/agent/config')
    .then(r => r.json() as Promise<ServerAgentConfig>)
    // re-render only while nothing is in progress, so typed text and the conversation are kept
    .then(cfg => { serverCfg = cfg; if (el.isConnected && !busy && !conversationId) render(); })
    .catch(() => undefined);

  render();
  return () => { controllerAbort?.abort(); };
}
