import { api } from '../api.js';
import { icon } from '../icons.js';
import { t, fmtNumber, fmtDate } from '../i18n.js';
import { state, on } from '../store.js';
import { $, $$, closeDrawer, debounce, errMsg, esc, html, openDrawer, toast } from '../util.js';
import { LiveView, PickInfo } from '../liveView.js';
import type { ExtractKind, ScrapeField, ScrapeRecipe, ViewContext } from '../types.js';

type Rows = Record<string, string | null>[];

const COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#fb7185', '#a3e635', '#f97316', '#2dd4bf'];
const EXTRACTS: ExtractKind[] = ['text', 'href', 'src', 'attr', 'html', 'value'];
const DRAFT_KEY = 'dx-scraper-draft';

function loadDraft(): ScrapeRecipe {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') as ScrapeRecipe | null;
    if (d && Array.isArray(d.fields)) return d;
  } catch { /* storage blocked */ }
  return { fields: [], maxPages: 1 };
}

function saveDraft(r: ScrapeRecipe) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(r)); } catch { /* storage blocked */ }
}

/** CSV with a UTF-8 BOM so spreadsheet apps show non-Latin text correctly. */
function toCSV(rows: Rows): string {
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.map(cell).join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** GitHub-flavoured Markdown table (same format as the server's .md files). */
function toMarkdown(rows: Rows, title: string, url?: string): string {
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const cell = (v: unknown) => (v == null ? '' : String(v))
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>')
    .trim();
  const lines = [`# ${cell(title)}`, ''];
  if (url) lines.push(`- Source: ${url}`);
  lines.push(`- Rows: ${rows.length}`, `- Scraped: ${new Date().toISOString()}`, '');
  lines.push(`| # | ${cols.map(cell).join(' | ')} |`, `|---:|${cols.map(() => '---').join('|')}|`);
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${cols.map(c => cell(r[c])).join(' | ')} |`));
  return lines.join('\n') + '\n';
}

function download(name: string, content: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function mount(el: HTMLElement, _params: string[], { setHeader }: ViewContext): () => void {
  setHeader(t('scraper.title'), t('scraper.subtitle'));

  const recipe: ScrapeRecipe = loadDraft();
  let rows: Rows = [];
  let lastRun: { files: { json: string; csv: string; md: string } | null; sessionId: string; pages: number } | null = null;
  let pickingNext = false;
  let running = !!state.session && ['running', 'starting'].includes(state.session.status);

  html(el, `
    <div class="stack">
      <form class="card scraper-open" id="openForm">
        <div class="url-wrap">${icon('globe')}<input class="input lg ltr" id="openUrl" spellcheck="false" placeholder="https://example.com" value="${esc(recipe.url || state.session?.currentUrl || state.config?.targetUrl || '')}"></div>
        <button class="btn primary lg" type="submit" id="openBtn">${icon('play')}<span>${esc(t('scraper.open'))}</span></button>
      </form>

      <div class="scraper-grid">
        <div class="browser">
          <div class="browser-bar">
            <button class="icon-btn" data-nav="back" type="button">${icon('left')}</button>
            <button class="icon-btn" data-nav="forward" type="button">${icon('right')}</button>
            <button class="icon-btn" data-nav="reload" type="button">${icon('refresh')}</button>
            <div class="seg" id="modeSeg">
              <button type="button" data-mode="browse" class="active">${icon('mouse')}${esc(t('scraper.mode.browse'))}</button>
              <button type="button" data-mode="select">${icon('zap')}${esc(t('scraper.mode.select'))}</button>
            </div>
            <span class="spacer"></span>
            <span class="pill" id="wsState"><span class="dot"></span><span></span></span>
          </div>
          <div id="scraperView"></div>
          <div class="browser-foot" id="scraperHint">${icon('mouse')}<span></span></div>
        </div>

        <div class="side-col scraper-side">
          <div class="card">
            <div class="card-head">${icon('layers')}<h3>${esc(t('scraper.list'))}</h3><span class="spacer"></span><span id="listBadge"></span></div>
            <div id="listBox"></div>
          </div>
          <div class="card">
            <div class="card-head">${icon('code')}<h3>${esc(t('scraper.fields'))}</h3><span class="spacer"></span><span class="pill" id="fieldCount"></span></div>
            <div id="fieldsBox"></div>
          </div>
          <div class="card">
            <div class="card-head">${icon('right')}<h3>${esc(t('scraper.pagination'))}</h3></div>
            <div class="stack" style="gap:8px">
              <div class="row" style="flex-wrap:nowrap">
                <input class="input ltr mono" id="nextSel" placeholder="${esc(t('scraper.next.placeholder'))}" value="${esc(recipe.nextSelector || '')}">
                <button class="btn sm" type="button" id="pickNext">${icon('zap')}${esc(t('scraper.next.pick'))}</button>
              </div>
              <label class="row small">${esc(t('scraper.maxPages'))}<input class="input" id="maxPages" type="number" min="1" max="100" style="width:90px" value="${recipe.maxPages || 1}"></label>
            </div>
          </div>
          <div class="card">
            <div class="row">
              <button class="btn" type="button" id="previewBtn">${icon('eye')}${esc(t('scraper.preview'))}</button>
              <button class="btn primary" type="button" id="runBtn">${icon('play')}${esc(t('scraper.run'))}</button>
            </div>
          </div>
          <div class="card">
            <div class="card-head">${icon('archive')}<h3>${esc(t('scraper.recipes'))}</h3></div>
            <div class="row" style="flex-wrap:nowrap;margin-bottom:10px">
              <input class="input" id="recipeName" placeholder="${esc(t('scraper.recipe.name'))}" value="${esc(recipe.name || '')}">
              <button class="btn sm" type="button" id="saveRecipe">${icon('check')}${esc(t('scraper.recipe.save'))}</button>
            </div>
            <div id="recipesBox" class="small muted"></div>
          </div>
        </div>
      </div>

      <div class="card" id="resultsCard">
        <div class="card-head">${icon('database')}<h3>${esc(t('scraper.results'))}</h3><span class="pill accent" id="rowCount">0</span><span class="spacer"></span>
          <span id="savedFiles" class="row" style="gap:6px"></span>
          <button class="btn sm ghost" type="button" id="dlCsv">${icon('download')}CSV</button>
          <button class="btn sm ghost" type="button" id="dlJson">${icon('download')}JSON</button>
          <button class="btn sm ghost" type="button" id="dlMd">${icon('download')}MD</button>
        </div>
        <div id="resultsBox"></div>
      </div>
    </div>`);

  // ------------------------------------------------------------ live view
  const live = new LiveView($('#scraperView', el), {
    itemSelector: () => (pickingNext ? undefined : recipe.itemSelector),
    onPick: info => handlePick(info),
    onFrame: () => refreshHighlights(),
    onNavigated: url => {
      if (document.activeElement !== $('#openUrl', el)) $<HTMLInputElement>('#openUrl', el).value = url;
      setTimeout(() => { refreshHighlights(); schedulePreview(); }, 600);
    },
    onStatus: s => {
      running = s.running;
      updateHint();
      if (s.running) { refreshHighlights(); schedulePreview(); }
    },
    onConnection: c => {
      const pill = $('#wsState', el);
      pill.className = `pill ${c ? 'ok' : 'err'}`;
      pill.lastElementChild!.textContent = c ? 'WebSocket' : t('conn.off');
    },
    onError: message => toast(message, 'err')
  });

  const setMode = (mode: 'browse' | 'select') => {
    live.setMode(mode);
    $$('#modeSeg button', el).forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    updateHint();
  };
  $('#modeSeg', el).onclick = e => {
    const b = (e.target as Element).closest<HTMLElement>('button[data-mode]');
    if (b) { pickingNext = false; setMode(b.dataset.mode as 'browse' | 'select'); }
  };
  $$('[data-nav]', el).forEach(b => { b.onclick = () => live.history(b.dataset.nav as 'back' | 'forward' | 'reload'); });

  const updateHint = () => {
    const hint = $('#scraperHint span', el);
    if (!running) hint.textContent = t('scraper.hint.start');
    else if (pickingNext) hint.textContent = t('scraper.hint.next');
    else if (live.mode === 'select') hint.textContent = recipe.itemSelector ? t('scraper.hint.selectInList') : t('scraper.hint.select');
    else hint.textContent = t('scraper.hint.browse');
  };

  // ------------------------------------------------------------ open
  $<HTMLFormElement>('#openForm', el).onsubmit = async e => {
    e.preventDefault();
    const url = $<HTMLInputElement>('#openUrl', el).value.trim();
    if (!url) return;
    recipe.url = url;
    saveDraft(recipe);
    if (running) {
      live.navigate(url);
      return;
    }
    const btn = $<HTMLButtonElement>('#openBtn', el);
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span><span>${esc(t('live.starting'))}</span>`;
    try {
      await api.start({ url, headless: true });
      setMode('select');
    } catch (err) {
      toast(errMsg(err), 'err', 7000);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('play')}<span>${esc(t('scraper.open'))}</span>`;
    }
  };

  // ------------------------------------------------------------ picking
  const uniqueName = (base: string) => {
    let name = base || 'field';
    let i = 2;
    while (recipe.fields.some(f => f.name === name)) name = `${base}_${i++}`;
    return name;
  };

  const addField = (selector: string, info: PickInfo) => {
    if (recipe.fields.some(f => f.selector === selector && f.extract === info.suggestedExtract)) {
      toast(t('scraper.field.exists'), 'info');
      return;
    }
    recipe.fields.push({ name: uniqueName(info.suggestedName), selector, extract: info.suggestedExtract });
    // links and images: also offer the URL as its own column
    if (info.tag === 'a' && info.href && info.suggestedExtract === 'text') {
      recipe.fields.push({ name: uniqueName(`${info.suggestedName}_url`), selector, extract: 'href' });
    }
    changed();
  };

  const handlePick = (info: PickInfo) => {
    if (pickingNext) {
      pickingNext = false;
      recipe.nextSelector = info.selector;
      $<HTMLInputElement>('#nextSel', el).value = info.selector;
      if ((recipe.maxPages || 1) < 2) {
        recipe.maxPages = 5;
        $<HTMLInputElement>('#maxPages', el).value = '5';
      }
      setMode('browse');
      changed();
      toast(t('scraper.next.set'), 'ok');
      return;
    }
    if (recipe.itemSelector) {
      if (!info.inItem) {
        toast(t('scraper.outsideList'), 'err', 5000);
        return;
      }
      addField(info.inItem.fieldSelector, info);
      return;
    }
    if (!info.listCandidates.length) {
      addField(info.selector, info);
      return;
    }
    // ask: one element, or every item of a repeating list?
    const preview = info.text || info.href || info.src || '';
    const body = openDrawer(t('scraper.pick.title'), `
      <div class="card">
        <div class="row"><code class="ltr">&lt;${esc(info.tag)}&gt;</code><span class="muted small ltr truncate">${esc(info.selector)}</span></div>
        ${preview ? `<p class="ltr" style="margin:8px 0 0">${esc(preview.slice(0, 200))}</p>` : ''}
      </div>
      <h4>${esc(t('scraper.pick.question'))}</h4>
      <div class="stack" style="gap:8px">
        ${info.listCandidates.map((c, i) => `
          <button class="choice" data-list="${i}">
            <strong>${esc(t('scraper.pick.list', { n: fmtNumber(c.count) }))}</strong>
            <code class="ltr">${esc(c.itemSelector)}</code>
          </button>`).join('')}
        <button class="choice" data-single="1">
          <strong>${esc(t('scraper.pick.single'))}</strong>
          <code class="ltr">${esc(info.selector)}</code>
        </button>
      </div>`);
    body.onclick = e => {
      const b = (e.target as Element).closest<HTMLElement>('.choice');
      if (!b) return;
      closeDrawer();
      if (b.dataset.single) {
        addField(info.selector, info);
      } else {
        const c = info.listCandidates[Number(b.dataset.list)];
        recipe.itemSelector = c.itemSelector;
        addField(c.fieldSelector, info);
        toast(t('scraper.listSet', { n: fmtNumber(c.count) }), 'ok');
      }
    };
    // show where each candidate list is on the page
    const groups = info.listCandidates.map((c, i) => ({ key: `cand${i}`, selector: '', itemSelector: c.itemSelector }));
    void live.request<{ groups: Record<string, any[]> }>({ t: 'boxes', specs: groups }).then(res => {
      if (!res) return;
      live.setHighlights([...live.highlights, { key: 'cand', color: '#fbbf24', boxes: res.groups.cand0 || [] }]);
    });
  };

  $('#pickNext', el).onclick = () => {
    pickingNext = true;
    setMode('select');
  };

  // ------------------------------------------------------------ recipe panel
  const renderList = () => {
    const box = $('#listBox', el);
    const badge = $('#listBadge', el);
    if (!recipe.itemSelector) {
      badge.innerHTML = '';
      html(box, `<p class="muted small" style="margin:0">${esc(t('scraper.list.none'))}</p>`);
      return;
    }
    badge.innerHTML = `<span class="pill info" id="itemCount">…</span>`;
    html(box, `
      <div class="row" style="flex-wrap:nowrap">
        <input class="input ltr mono" id="itemSel" value="${esc(recipe.itemSelector)}">
        <button class="icon-btn" type="button" id="clearList" title="${esc(t('scraper.list.clear'))}">${icon('x')}</button>
      </div>`);
    $<HTMLInputElement>('#itemSel', el).onchange = e => {
      recipe.itemSelector = (e.target as HTMLInputElement).value.trim() || undefined;
      changed();
    };
    $('#clearList', el).onclick = () => {
      recipe.itemSelector = undefined;
      recipe.fields = [];
      changed();
    };
    void api.scraperCount(recipe.itemSelector).then(r => {
      const n = el.querySelector('#itemCount');
      if (n) n.textContent = r.valid ? t('scraper.items', { n: fmtNumber(r.count) }) : t('scraper.invalid');
    }).catch(() => undefined);
  };

  const renderFields = () => {
    const box = $('#fieldsBox', el);
    $('#fieldCount', el).textContent = fmtNumber(recipe.fields.length);
    if (!recipe.fields.length) {
      html(box, `<div class="empty small">${icon('zap')}<div>${esc(t('scraper.fields.empty'))}</div></div>`);
      return;
    }
    const sample = rows[0] || {};
    html(box, `<div class="stack" style="gap:10px">${recipe.fields.map((f, i) => `
      <div class="field-card" data-i="${i}" style="--c:${COLORS[i % COLORS.length]}">
        <div class="row" style="flex-wrap:nowrap">
          <span class="swatch"></span>
          <input class="input sm" data-k="name" value="${esc(f.name)}">
          <select class="select sm" data-k="extract">${EXTRACTS.map(x => `<option value="${x}" ${f.extract === x ? 'selected' : ''}>${esc(t('scraper.extract.' + x))}</option>`).join('')}</select>
          <button class="icon-btn" type="button" data-remove="${i}">${icon('trash')}</button>
        </div>
        ${f.extract === 'attr' ? `<input class="input sm ltr mono" data-k="attribute" placeholder="${esc(t('scraper.attribute'))}" value="${esc(f.attribute || '')}">` : ''}
        <input class="input sm ltr mono" data-k="selector" value="${esc(f.selector)}" placeholder="${esc(recipe.itemSelector ? t('scraper.selector.item') : 'CSS')}">
        <div class="sample ltr" title="${esc(sample[f.name] ?? '')}">${sample[f.name] != null ? esc(String(sample[f.name]).slice(0, 140)) : '<span class="muted">—</span>'}</div>
      </div>`).join('')}</div>`);
  };

  $('#fieldsBox', el).addEventListener('change', e => {
    const input = e.target as HTMLInputElement;
    const card = input.closest<HTMLElement>('.field-card');
    if (!card || !input.dataset.k) return;
    const f = recipe.fields[Number(card.dataset.i)] as ScrapeField & Record<string, unknown>;
    const v = input.value.trim();
    if (input.dataset.k === 'name') {
      if (!v || recipe.fields.some((o, j) => o.name === v && j !== Number(card.dataset.i))) { input.value = f.name; return; }
      f.name = v;
    } else if (input.dataset.k === 'extract') {
      f.extract = v as ExtractKind;
    } else {
      f[input.dataset.k] = v;
    }
    changed();
  });
  $('#fieldsBox', el).addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-remove]');
    if (!b) return;
    recipe.fields.splice(Number(b.dataset.remove), 1);
    if (!recipe.fields.length) recipe.itemSelector = undefined;
    changed();
  });

  $<HTMLInputElement>('#nextSel', el).onchange = e => {
    recipe.nextSelector = (e.target as HTMLInputElement).value.trim() || undefined;
    changed();
  };
  $<HTMLInputElement>('#maxPages', el).onchange = e => {
    recipe.maxPages = Math.max(1, Math.min(100, Number((e.target as HTMLInputElement).value) || 1));
    saveDraft(recipe);
  };

  // ------------------------------------------------------------ highlights + preview
  const refreshHighlights = debounce(async () => {
    if (!running || !live.connected) return;
    const specs = recipe.fields.map((f, i) => ({ key: `f${i}`, selector: f.selector, itemSelector: recipe.itemSelector }));
    if (recipe.itemSelector) specs.push({ key: 'item', selector: '', itemSelector: recipe.itemSelector });
    if (recipe.nextSelector) specs.push({ key: 'next', selector: recipe.nextSelector, itemSelector: undefined });
    if (!specs.length) { live.setHighlights([]); return; }
    const res = await live.request<{ groups: Record<string, any[]> }>({ t: 'boxes', specs });
    if (!res) return;
    live.setHighlights([
      ...(res.groups.item ? [{ key: 'item', color: '#94a3b8', boxes: res.groups.item }] : []),
      ...recipe.fields.map((f, i) => ({ key: `f${i}`, color: COLORS[i % COLORS.length], boxes: res.groups[`f${i}`] || [], label: f.name })),
      ...(res.groups.next ? [{ key: 'next', color: '#f97316', boxes: res.groups.next, label: t('scraper.next.label') }] : [])
    ]);
  }, 120);

  const renderResults = () => {
    $('#rowCount', el).textContent = fmtNumber(rows.length);
    const files = $('#savedFiles', el);
    files.innerHTML = lastRun?.files
      ? `<a class="btn sm" href="${api.fileUrl(lastRun.sessionId, lastRun.files.csv, true)}">${icon('download')}${esc(t('scraper.saved'))} CSV</a>
         <a class="btn sm" href="${api.fileUrl(lastRun.sessionId, lastRun.files.json, true)}">${icon('download')}JSON</a>
         <a class="btn sm" href="${api.fileUrl(lastRun.sessionId, lastRun.files.md, true)}">${icon('download')}MD</a>`
      : '';
    const box = $('#resultsBox', el);
    if (!rows.length) {
      html(box, `<div class="empty small">${icon('database')}<div>${esc(t('scraper.results.empty'))}</div></div>`);
      return;
    }
    const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
    html(box, `<div class="table-wrap" style="max-height:460px"><table class="table">
      <thead><tr><th>#</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 1000).map((r, i) => `<tr><td class="muted">${i + 1}</td>${cols.map(c => {
        const v = r[c];
        const s = v == null ? '' : String(v);
        const isUrl = /^https?:\/\//.test(s);
        return `<td class="ltr scrape-cell" title="${esc(s)}">${isUrl ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(s.slice(0, 120))}</a>` : esc(s.slice(0, 300))}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      ${rows.length > 1000 ? `<p class="muted small">${esc(t('scraper.results.more', { n: fmtNumber(rows.length - 1000) }))}</p>` : ''}`);
  };

  const preview = async () => {
    if (!running || !recipe.fields.length) {
      rows = [];
      renderFields();
      renderResults();
      return;
    }
    try {
      const res = await api.scraperPreview(recipe);
      rows = res.rows;
      lastRun = null;
    } catch (err) {
      rows = [];
      toast(errMsg(err), 'err');
    }
    renderFields();
    renderResults();
  };
  const schedulePreview = debounce(preview, 300);

  /** Something in the recipe changed: persist, re-render and refresh. */
  const changed = () => {
    saveDraft(recipe);
    renderList();
    renderFields();
    updateHint();
    refreshHighlights();
    schedulePreview();
  };

  $('#previewBtn', el).onclick = () => void preview();
  $('#runBtn', el).onclick = async () => {
    if (!recipe.fields.length) { toast(t('scraper.fields.empty'), 'err'); return; }
    const b = $<HTMLButtonElement>('#runBtn', el);
    b.disabled = true;
    b.innerHTML = `<span class="spinner"></span>${esc(t('scraper.running'))}`;
    try {
      const res = await api.scraperRun({ ...recipe, maxPages: recipe.nextSelector ? recipe.maxPages || 1 : 1 });
      rows = res.rows;
      lastRun = { files: res.files, sessionId: res.sessionId, pages: res.pages };
      renderFields();
      renderResults();
      toast(t('scraper.done', { rows: fmtNumber(res.rows.length), pages: fmtNumber(res.pages) }), 'ok');
      $('#resultsCard', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      toast(errMsg(err), 'err', 7000);
    } finally {
      b.disabled = false;
      b.innerHTML = `${icon('play')}${esc(t('scraper.run'))}`;
    }
  };

  const fileBase = () => (recipe.name || 'scrape').replace(/[^\w؀-ۿ-]+/g, '-');
  $('#dlCsv', el).onclick = () => rows.length && download(`${fileBase()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  $('#dlJson', el).onclick = () => rows.length && download(`${fileBase()}.json`, JSON.stringify(rows, null, 2), 'application/json');
  $('#dlMd', el).onclick = () => rows.length && download(`${fileBase()}.md`, toMarkdown(rows, recipe.name || 'Scrape', $<HTMLInputElement>('#openUrl', el).value.trim() || recipe.url), 'text/markdown;charset=utf-8');

  // ------------------------------------------------------------ recipes
  const renderRecipes = async () => {
    const box = $('#recipesBox', el);
    try {
      const list = await api.recipes();
      if (!list.length) { box.textContent = t('scraper.recipes.empty'); return; }
      html(box, `<ul class="list-plain">${list.map(r => `
        <li><span style="flex:1" class="truncate" title="${esc(r.url || '')}"><strong>${esc(r.name || '')}</strong> · ${esc(t('scraper.fieldsN', { n: fmtNumber(r.fields.length) }))} · ${esc(fmtDate(r.updatedAt))}</span>
          <button class="btn sm ghost" type="button" data-load="${esc(r.name || '')}">${esc(t('common.open'))}</button>
          <button class="icon-btn" type="button" data-del="${esc(r.name || '')}">${icon('trash')}</button></li>`).join('')}</ul>`);
      box.onclick = async e => {
        const target = e.target as Element;
        const load = target.closest<HTMLElement>('[data-load]');
        const del = target.closest<HTMLElement>('[data-del]');
        if (load) {
          const r = list.find(x => x.name === load.dataset.load);
          if (!r) return;
          Object.assign(recipe, { name: r.name, url: r.url, itemSelector: r.itemSelector, fields: r.fields, nextSelector: r.nextSelector, maxPages: r.maxPages || 1 });
          $<HTMLInputElement>('#recipeName', el).value = r.name || '';
          $<HTMLInputElement>('#nextSel', el).value = r.nextSelector || '';
          $<HTMLInputElement>('#maxPages', el).value = String(r.maxPages || 1);
          if (r.url) $<HTMLInputElement>('#openUrl', el).value = r.url;
          changed();
          toast(t('scraper.recipe.loaded'), 'ok');
        } else if (del && confirm(t('scraper.recipe.deleteConfirm'))) {
          await api.deleteRecipe(del.dataset.del!);
          void renderRecipes();
        }
      };
    } catch (err) {
      box.textContent = errMsg(err);
    }
  };

  $('#saveRecipe', el).onclick = async () => {
    const name = $<HTMLInputElement>('#recipeName', el).value.trim();
    if (!name) { toast(t('scraper.recipe.nameRequired'), 'err'); return; }
    recipe.name = name;
    recipe.url = $<HTMLInputElement>('#openUrl', el).value.trim() || recipe.url;
    try {
      await api.saveRecipe(recipe);
      saveDraft(recipe);
      toast(t('scraper.recipe.saved'), 'ok');
      void renderRecipes();
    } catch (err) {
      toast(errMsg(err), 'err');
    }
  };

  const unsub = on('status', s => {
    running = !!s && ['running', 'starting'].includes(s.status);
    updateHint();
  });

  renderList();
  renderFields();
  renderResults();
  void renderRecipes();
  updateHint();
  if (running) setMode('select');

  return () => {
    live.destroy();
    unsub();
  };
}
