'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { LiveCanvas } from '@/components/LiveCanvas';
import { Empty, Seg, Spinner } from '@/components/ui';
import { api, type ScrapeRun } from '@/lib/api';
import { download, errMsg } from '@/lib/format';
import { fmtDate, fmtNumber, t } from '@/lib/i18n';
import type { LiveView, PickInfo } from '@/lib/liveView';
import { state, useStoreVersion } from '@/lib/store';
import type { ExtractKind, ScrapeField, ScrapeRecipe } from '@/lib/types';
import { closeDrawer, openDrawer, toast, useHeader } from '@/lib/ui';

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
  return '\uFEFF' + [cols.map(cell).join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** GitHub-flavoured Markdown table (same format as the server's .md files). */
function toMarkdown(rows: Rows, title: string, url?: string): string {
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const cell = (v: unknown) => (v == null ? '' : String(v))
    .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>').trim();
  const lines = [`# ${cell(title)}`, ''];
  if (url) lines.push(`- Source: ${url}`);
  lines.push(`- Rows: ${rows.length}`, `- Scraped: ${new Date().toISOString()}`, '');
  lines.push(`| # | ${cols.map(cell).join(' | ')} |`, `|---:|${cols.map(() => '---').join('|')}|`);
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${cols.map(c => cell(r[c])).join(' | ')} |`));
  return lines.join('\n') + '\n';
}

function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback((...args: A) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ref.current(...args), ms);
  }, [ms]);
}

const isRunning = () => !!state.session && ['running', 'starting'].includes(state.session.status);

export function ScraperView() {
  useHeader(t('scraper.title'), t('scraper.subtitle'));
  useStoreVersion(['status', 'hello']);

  const [recipe, setRecipeState] = useState<ScrapeRecipe>(() => loadDraft());
  const recipeRef = useRef(recipe);
  const [rows, setRows] = useState<Rows>([]);
  const [lastRun, setLastRun] = useState<{ files: ScrapeRun['files']; sessionId: string } | null>(null);
  const [mode, setModeState] = useState<'browse' | 'select'>('browse');
  const [pickingNext, setPickingNext] = useState(false);
  const pickingRef = useRef(false);
  const [running, setRunning] = useState(isRunning());
  const runningRef = useRef(running);
  const [wsConnected, setWsConnected] = useState(false);
  const [openUrl, setOpenUrl] = useState(recipe.url || state.session?.currentUrl || state.config?.targetUrl || '');
  const urlFocused = useRef(false);
  const [opening, setOpening] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [itemCount, setItemCount] = useState<string>('…');
  const [recipes, setRecipes] = useState<(ScrapeRecipe & { updatedAt: string })[] | null>(null);
  const [recipeName, setRecipeName] = useState(recipe.name || '');
  const live = useRef<LiveView | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  runningRef.current = running;
  pickingRef.current = pickingNext;

  /**
   * After "Extract all pages" the table shows every extracted row: the automatic preview (which
   * the pagination's page changes would trigger) stays off until the recipe changes.
   */
  const keepResults = useRef(false);

  /** Replace the recipe: persist, re-render, refresh highlights and the preview. */
  const updateRecipe = (next: ScrapeRecipe, opts: { refresh?: boolean } = { refresh: true }) => {
    recipeRef.current = next;
    setRecipeState(next);
    saveDraft(next);
    if (opts.refresh !== false) {
      keepResults.current = false;
      refreshHighlights();
      schedulePreview();
    }
  };

  const setMode = (m: 'browse' | 'select') => {
    live.current?.setMode(m);
    setModeState(m);
  };

  // ------------------------------------------------------------ session status
  useEffect(() => {
    const now = isRunning();
    if (now !== runningRef.current) setRunning(now);
  });

  // ------------------------------------------------------------ highlights + preview
  const refreshHighlights = useDebounced(async () => {
    const view = live.current;
    const r = recipeRef.current;
    if (!runningRef.current || !view?.connected) return;
    const specs: { key: string; selector: string; itemSelector?: string }[] = r.fields.map((f, i) => ({ key: `f${i}`, selector: f.selector, itemSelector: r.itemSelector }));
    if (r.itemSelector) specs.push({ key: 'item', selector: '', itemSelector: r.itemSelector });
    if (r.nextSelector) specs.push({ key: 'next', selector: r.nextSelector, itemSelector: undefined });
    if (!specs.length) { view.setHighlights([]); return; }
    const res = await view.request<{ groups: Record<string, any[]> }>({ t: 'boxes', specs });
    if (!res) return;
    view.setHighlights([
      ...(res.groups.item ? [{ key: 'item', color: '#94a3b8', boxes: res.groups.item }] : []),
      ...r.fields.map((f, i) => ({ key: `f${i}`, color: COLORS[i % COLORS.length], boxes: res.groups[`f${i}`] || [], label: f.name })),
      ...(res.groups.next ? [{ key: 'next', color: '#f97316', boxes: res.groups.next, label: t('scraper.next.label') }] : [])
    ]);
  }, 120);

  const preview = async () => {
    const r = recipeRef.current;
    if (!runningRef.current || !r.fields.length) {
      setRows([]);
      return;
    }
    try {
      const res = await api.scraperPreview(r);
      if (keepResults.current) return;
      setRows(res.rows);
      setLastRun(null);
    } catch (err) {
      setRows([]);
      toast(errMsg(err), 'err');
    }
  };
  const schedulePreview = useDebounced(() => { if (!keepResults.current) void preview(); }, 300);

  // list item count
  useEffect(() => {
    if (!recipe.itemSelector || !running) return;
    setItemCount('…');
    api.scraperCount(recipe.itemSelector)
      .then(r => setItemCount(r.valid ? t('scraper.items', { n: fmtNumber(r.count) }) : t('scraper.invalid')))
      .catch(() => undefined);
  }, [recipe.itemSelector, running]);

  // the page became available: select mode, highlights, preview
  useEffect(() => {
    if (running) {
      setMode('select');
      refreshHighlights();
      schedulePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // ------------------------------------------------------------ picking
  const uniqueName = (fields: ScrapeField[], base: string) => {
    let name = base || 'field';
    let i = 2;
    while (fields.some(f => f.name === name)) name = `${base}_${i++}`;
    return name;
  };

  const addField = (r: ScrapeRecipe, selector: string, info: PickInfo) => {
    if (r.fields.some(f => f.selector === selector && f.extract === info.suggestedExtract)) {
      toast(t('scraper.field.exists'), 'info');
      return;
    }
    const fields = [...r.fields, { name: uniqueName(r.fields, info.suggestedName), selector, extract: info.suggestedExtract }];
    // links: also offer the URL as its own column
    if (info.tag === 'a' && info.href && info.suggestedExtract === 'text') {
      fields.push({ name: uniqueName(fields, `${info.suggestedName}_url`), selector, extract: 'href' });
    }
    updateRecipe({ ...r, fields });
  };

  const handlePick = (info: PickInfo) => {
    const r = recipeRef.current;
    if (pickingRef.current) {
      setPickingNext(false);
      updateRecipe({ ...r, nextSelector: info.selector, maxPages: (r.maxPages || 1) < 2 ? 5 : r.maxPages });
      setMode('browse');
      toast(t('scraper.next.set'), 'ok');
      return;
    }
    if (r.itemSelector) {
      if (!info.inItem) {
        toast(t('scraper.outsideList'), 'err', 5000);
        return;
      }
      addField(r, info.inItem.fieldSelector, info);
      return;
    }
    if (!info.listCandidates.length) {
      addField(r, info.selector, info);
      return;
    }
    // ask: one element, or every item of a repeating list?
    const previewText = info.text || info.href || info.src || '';
    const choose = (list: number | null) => {
      closeDrawer();
      const cur = recipeRef.current;
      if (list === null) {
        addField(cur, info.selector, info);
      } else {
        const c = info.listCandidates[list];
        addField({ ...cur, itemSelector: c.itemSelector }, c.fieldSelector, info);
        toast(t('scraper.listSet', { n: fmtNumber(c.count) }), 'ok');
      }
    };
    openDrawer(t('scraper.pick.title'), (
      <>
        <div className="card">
          <div className="row"><code className="ltr">&lt;{info.tag}&gt;</code><span className="muted small ltr truncate">{info.selector}</span></div>
          {previewText && <p className="ltr" style={{ margin: '8px 0 0' }}>{previewText.slice(0, 200)}</p>}
        </div>
        <h4>{t('scraper.pick.question')}</h4>
        <div className="stack" style={{ gap: 8 }}>
          {info.listCandidates.map((c, i) => (
            <button key={i} className="choice" data-list={i} onClick={() => choose(i)}>
              <strong>{t('scraper.pick.list', { n: fmtNumber(c.count) })}</strong>
              <code className="ltr">{c.itemSelector}</code>
            </button>
          ))}
          <button className="choice" data-single="1" onClick={() => choose(null)}>
            <strong>{t('scraper.pick.single')}</strong>
            <code className="ltr">{info.selector}</code>
          </button>
        </div>
      </>
    ));
    // show where the first candidate list is on the page
    const view = live.current;
    const specs = info.listCandidates.map((c, i) => ({ key: `cand${i}`, selector: '', itemSelector: c.itemSelector }));
    void view?.request<{ groups: Record<string, any[]> }>({ t: 'boxes', specs }).then(res => {
      if (!res || !live.current) return;
      live.current.setHighlights([...live.current.highlights, { key: 'cand', color: '#fbbf24', boxes: res.groups.cand0 || [] }]);
    });
  };

  // ------------------------------------------------------------ open
  const open = async (e: FormEvent) => {
    e.preventDefault();
    const url = openUrl.trim();
    if (!url) return;
    updateRecipe({ ...recipeRef.current, url }, { refresh: false });
    if (runningRef.current) {
      live.current?.navigate(url);
      return;
    }
    setOpening(true);
    try {
      await api.start({ url, headless: true });
    } catch (err) {
      toast(errMsg(err), 'err', 7000);
    } finally {
      setOpening(false);
    }
  };

  // ------------------------------------------------------------ run / export
  const run = async () => {
    const r = recipeRef.current;
    if (!r.fields.length) { toast(t('scraper.fields.empty'), 'err'); return; }
    setRunBusy(true);
    keepResults.current = true;
    try {
      const res = await api.scraperRun({ ...r, maxPages: r.nextSelector ? r.maxPages || 1 : 1 });
      setRows(res.rows);
      setLastRun({ files: res.files, sessionId: res.sessionId });
      toast(t('scraper.done', { rows: fmtNumber(res.rows.length), pages: fmtNumber(res.pages) }), 'ok');
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      keepResults.current = false;
      toast(errMsg(err), 'err', 7000);
    } finally {
      setRunBusy(false);
    }
  };
  const fileBase = () => (recipe.name || 'scrape').replace(/[^\w\u0600-\u06FF-]+/g, '-');

  // ------------------------------------------------------------ recipes
  const loadRecipes = useCallback(async () => {
    try { setRecipes(await api.recipes()); } catch (err) { toast(errMsg(err), 'err'); setRecipes([]); }
  }, []);
  useEffect(() => { void loadRecipes(); }, [loadRecipes]);

  const saveRecipe = async () => {
    const name = recipeName.trim();
    if (!name) { toast(t('scraper.recipe.nameRequired'), 'err'); return; }
    const next = { ...recipeRef.current, name, url: openUrl.trim() || recipeRef.current.url };
    try {
      await api.saveRecipe(next);
      updateRecipe(next, { refresh: false });
      toast(t('scraper.recipe.saved'), 'ok');
      void loadRecipes();
    } catch (err) {
      toast(errMsg(err), 'err');
    }
  };

  const loadRecipe = (r: ScrapeRecipe) => {
    updateRecipe({ name: r.name, url: r.url, itemSelector: r.itemSelector, fields: r.fields, nextSelector: r.nextSelector, maxPages: r.maxPages || 1 });
    setRecipeName(r.name || '');
    if (r.url) setOpenUrl(r.url);
    toast(t('scraper.recipe.loaded'), 'ok');
  };

  const deleteRecipe = async (name: string) => {
    if (!confirm(t('scraper.recipe.deleteConfirm'))) return;
    try { await api.deleteRecipe(name); } catch (err) { toast(errMsg(err), 'err'); }
    void loadRecipes();
  };

  // ------------------------------------------------------------ field editing
  const setField = (i: number, patch: Partial<ScrapeField>) => {
    const r = recipeRef.current;
    if (patch.name !== undefined) {
      const v = patch.name.trim();
      if (!v || r.fields.some((o, j) => o.name === v && j !== i)) return false;
      patch.name = v;
    }
    updateRecipe({ ...r, fields: r.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
    return true;
  };
  const removeField = (i: number) => {
    const r = recipeRef.current;
    const fields = r.fields.filter((_, j) => j !== i);
    updateRecipe({ ...r, fields, itemSelector: fields.length ? r.itemSelector : undefined });
  };

  const hint = !running ? t('scraper.hint.start')
    : pickingNext ? t('scraper.hint.next')
    : mode === 'select' ? (recipe.itemSelector ? t('scraper.hint.selectInList') : t('scraper.hint.select'))
    : t('scraper.hint.browse');
  const sample = rows[0] || {};
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));

  return (
    <div className="stack">
      <form className="card scraper-open" id="openForm" onSubmit={open}>
        <div className="url-wrap">
          <Icon name="globe" />
          <input className="input lg ltr" id="openUrl" spellCheck={false} placeholder="https://example.com" value={openUrl}
            onChange={e => setOpenUrl(e.target.value)} onFocus={() => { urlFocused.current = true; }} onBlur={() => { urlFocused.current = false; }} />
        </div>
        <button className="btn primary lg" type="submit" id="openBtn" disabled={opening}>
          {opening ? <><Spinner /><span>{t('live.starting')}</span></> : <><Icon name="play" /><span>{t('scraper.open')}</span></>}
        </button>
      </form>

      <div className="scraper-grid">
        <div className="browser">
          <div className="browser-bar">
            <button className="icon-btn" type="button" onClick={() => live.current?.history('back')}><Icon name="left" /></button>
            <button className="icon-btn" type="button" onClick={() => live.current?.history('forward')}><Icon name="right" /></button>
            <button className="icon-btn" type="button" onClick={() => live.current?.history('reload')}><Icon name="refresh" /></button>
            <Seg id="modeSeg" value={mode} onChange={m => { setPickingNext(false); setMode(m); }} options={[
              { key: 'browse', label: <><Icon name="mouse" />{t('scraper.mode.browse')}</> },
              { key: 'select', label: <><Icon name="zap" />{t('scraper.mode.select')}</> }
            ]} />
            <span className="spacer" />
            <span className={`pill ${wsConnected ? 'ok' : 'err'}`} id="wsState"><span className="dot" /><span>{wsConnected ? 'WebSocket' : t('conn.off')}</span></span>
          </div>
          <LiveCanvas
            id="scraperView"
            onReady={v => { live.current = v; }}
            options={{
              itemSelector: () => (pickingRef.current ? undefined : recipeRef.current.itemSelector),
              onPick: handlePick,
              onFrame: () => refreshHighlights(),
              onNavigated: url => {
                if (!urlFocused.current) setOpenUrl(url);
                setTimeout(() => { refreshHighlights(); schedulePreview(); }, 600);
              },
              onStatus: s => {
                setRunning(s.running);
                if (s.running) { refreshHighlights(); schedulePreview(); }
              },
              onConnection: setWsConnected,
              onError: message => toast(message, 'err')
            }}
          />
          <div className="browser-foot" id="scraperHint"><Icon name="mouse" /><span>{hint}</span></div>
        </div>

        <div className="side-col scraper-side">
          <div className="card">
            <div className="card-head"><Icon name="layers" /><h3>{t('scraper.list')}</h3><span className="spacer" />
              {recipe.itemSelector && <span className="pill info" id="itemCount">{itemCount}</span>}
            </div>
            {!recipe.itemSelector
              ? <p className="muted small" style={{ margin: 0 }}>{t('scraper.list.none')}</p>
              : (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="input ltr mono" id="itemSel" key={recipe.itemSelector} defaultValue={recipe.itemSelector}
                    onBlur={e => updateRecipe({ ...recipeRef.current, itemSelector: e.target.value.trim() || undefined })} />
                  <button className="icon-btn" type="button" id="clearList" title={t('scraper.list.clear')}
                    onClick={() => updateRecipe({ ...recipeRef.current, itemSelector: undefined, fields: [] })}><Icon name="x" /></button>
                </div>
              )}
          </div>

          <div className="card">
            <div className="card-head"><Icon name="code" /><h3>{t('scraper.fields')}</h3><span className="spacer" /><span className="pill" id="fieldCount">{fmtNumber(recipe.fields.length)}</span></div>
            <div id="fieldsBox">
              {!recipe.fields.length
                ? <Empty icon="zap" className="small">{t('scraper.fields.empty')}</Empty>
                : (
                  <div className="stack" style={{ gap: 10 }}>
                    {recipe.fields.map((f, i) => (
                      <div key={`${i}:${f.name}`} className="field-card" data-i={i} style={{ '--c': COLORS[i % COLORS.length] } as React.CSSProperties}>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <span className="swatch" />
                          <input className="input sm" data-k="name" defaultValue={f.name}
                            onBlur={e => { if (!setField(i, { name: e.target.value })) e.target.value = f.name; }} />
                          <select className="select sm" data-k="extract" value={f.extract} onChange={e => setField(i, { extract: e.target.value as ExtractKind })}>
                            {EXTRACTS.map(x => <option key={x} value={x}>{t('scraper.extract.' + x)}</option>)}
                          </select>
                          <button className="icon-btn" type="button" data-remove={i} onClick={() => removeField(i)}><Icon name="trash" /></button>
                        </div>
                        {f.extract === 'attr' && (
                          <input className="input sm ltr mono" data-k="attribute" placeholder={t('scraper.attribute')} defaultValue={f.attribute || ''}
                            onBlur={e => setField(i, { attribute: e.target.value.trim() })} />
                        )}
                        <input className="input sm ltr mono" data-k="selector" defaultValue={f.selector} placeholder={recipe.itemSelector ? t('scraper.selector.item') : 'CSS'}
                          onBlur={e => { if (e.target.value.trim() !== f.selector) setField(i, { selector: e.target.value.trim() }); }} />
                        <div className="sample ltr" title={sample[f.name] ?? ''}>
                          {sample[f.name] != null ? String(sample[f.name]).slice(0, 140) : <span className="muted">—</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><Icon name="right" /><h3>{t('scraper.pagination')}</h3></div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input className="input ltr mono" id="nextSel" placeholder={t('scraper.next.placeholder')} key={recipe.nextSelector || ''} defaultValue={recipe.nextSelector || ''}
                  onBlur={e => { const v = e.target.value.trim() || undefined; if (v !== recipe.nextSelector) updateRecipe({ ...recipeRef.current, nextSelector: v }); }} />
                <button className="btn sm" type="button" id="pickNext" onClick={() => { setPickingNext(true); setMode('select'); }}><Icon name="zap" />{t('scraper.next.pick')}</button>
              </div>
              <label className="row small">{t('scraper.maxPages')}
                <input className="input" id="maxPages" type="number" min={1} max={100} style={{ width: 90 }} value={recipe.maxPages || 1}
                  onChange={e => updateRecipe({ ...recipeRef.current, maxPages: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }, { refresh: false })} />
              </label>
            </div>
          </div>

          <div className="card">
            <div className="row">
              <button className="btn" type="button" id="previewBtn" onClick={() => { keepResults.current = false; void preview(); }}><Icon name="eye" />{t('scraper.preview')}</button>
              <button className="btn primary" type="button" id="runBtn" disabled={runBusy} onClick={run}>
                {runBusy ? <><Spinner />{t('scraper.running')}</> : <><Icon name="play" />{t('scraper.run')}</>}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><Icon name="archive" /><h3>{t('scraper.recipes')}</h3></div>
            <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 10 }}>
              <input className="input" id="recipeName" placeholder={t('scraper.recipe.name')} value={recipeName} onChange={e => setRecipeName(e.target.value)} />
              <button className="btn sm" type="button" id="saveRecipe" onClick={saveRecipe}><Icon name="check" />{t('scraper.recipe.save')}</button>
            </div>
            <div id="recipesBox" className="small muted">
              {!recipes ? '…' : !recipes.length ? t('scraper.recipes.empty') : (
                <ul className="list-plain">
                  {recipes.map(r => (
                    <li key={r.name}>
                      <span style={{ flex: 1 }} className="truncate" title={r.url || ''}>
                        <strong>{r.name}</strong> · {t('scraper.fieldsN', { n: fmtNumber(r.fields.length) })} · {fmtDate(r.updatedAt)}
                      </span>
                      <button className="btn sm ghost" type="button" data-load={r.name} onClick={() => loadRecipe(r)}>{t('common.open')}</button>
                      <button className="icon-btn" type="button" data-del={r.name} onClick={() => deleteRecipe(r.name || '')}><Icon name="trash" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card" id="resultsCard" ref={resultsRef}>
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <Icon name="database" /><h3>{t('scraper.results')}</h3><span className="pill accent" id="rowCount">{fmtNumber(rows.length)}</span><span className="spacer" />
          {lastRun?.files && (
            <span id="savedFiles" className="row" style={{ gap: 6 }}>
              <a className="btn sm" href={api.fileUrl(lastRun.sessionId, lastRun.files.csv, true)}><Icon name="download" />{t('scraper.saved')} CSV</a>
              <a className="btn sm" href={api.fileUrl(lastRun.sessionId, lastRun.files.json, true)}><Icon name="download" />JSON</a>
              <a className="btn sm" href={api.fileUrl(lastRun.sessionId, lastRun.files.md, true)}><Icon name="download" />MD</a>
            </span>
          )}
          <button className="btn sm ghost" type="button" id="dlCsv" onClick={() => rows.length && download(`${fileBase()}.csv`, toCSV(rows), 'text/csv;charset=utf-8')}><Icon name="download" />CSV</button>
          <button className="btn sm ghost" type="button" id="dlJson" onClick={() => rows.length && download(`${fileBase()}.json`, JSON.stringify(rows, null, 2), 'application/json')}><Icon name="download" />JSON</button>
          <button className="btn sm ghost" type="button" id="dlMd" onClick={() => rows.length && download(`${fileBase()}.md`, toMarkdown(rows, recipe.name || 'Scrape', openUrl.trim() || recipe.url), 'text/markdown;charset=utf-8')}><Icon name="download" />MD</button>
        </div>
        <div id="resultsBox">
          {!rows.length ? <Empty icon="database" className="small">{t('scraper.results.empty')}</Empty> : (
            <>
              <div className="table-wrap" style={{ maxHeight: 460 }}>
                <table className="table">
                  <thead><tr><th>#</th>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 1000).map((r, i) => (
                      <tr key={i}>
                        <td className="muted">{i + 1}</td>
                        {cols.map(c => {
                          const s = r[c] == null ? '' : String(r[c]);
                          return (
                            <td key={c} className="ltr scrape-cell" title={s}>
                              {/^https?:\/\//.test(s) ? <a href={s} target="_blank" rel="noopener noreferrer">{s.slice(0, 120)}</a> : s.slice(0, 300)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 1000 && <p className="muted small">{t('scraper.results.more', { n: fmtNumber(rows.length - 1000) })}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
