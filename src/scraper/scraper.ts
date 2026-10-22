/**
 * scraper.ts
 *
 * Interactive scraping on the session's page: element picking, list detection, extraction with
 * pagination, CSV / JSON output and reusable recipes.
 */

import fs from 'fs';
import path from 'path';
import { Page } from 'playwright';
import { installPicker, ExtractKind, PickInfo, PickedBox, ScrapeField } from './pickerScript';
import { OUTPUT_DIR } from '../core/sessionStore';
import { ensureDir, relPath } from '../utils/fileUtils';
import { debug } from '../utils/logger';

export type { PickInfo, PickedBox, ScrapeField, ExtractKind };

export interface Recipe {
  name?: string;
  /** page the recipe was made on (used when it is run again) */
  url?: string;
  itemSelector?: string;
  fields: ScrapeField[];
  /** "next page" element to click between pages */
  nextSelector?: string;
  maxPages?: number;
}

export interface ScrapeResult {
  rows: Record<string, string | null>[];
  pages: number;
  /** page the extraction started on */
  startUrl: string;
  /** page it ended on (differs from startUrl after pagination) */
  url: string;
  stoppedBecause: 'maxPages' | 'noNext' | 'noProgress' | 'singlePage';
}

const EXTRACT_KINDS: ExtractKind[] = ['text', 'href', 'src', 'html', 'attr', 'value'];

/** Validate a recipe that came from a client or a model. */
export function normalizeRecipe(raw: any): Recipe {
  if (!raw || typeof raw !== 'object') throw new Error('recipe must be an object');
  const fields: ScrapeField[] = (Array.isArray(raw.fields) ? raw.fields : []).map((f: any, i: number) => {
    const name = String(f?.name ?? '').trim() || `field_${i + 1}`;
    const extract = EXTRACT_KINDS.includes(f?.extract) ? f.extract : 'text';
    if (extract === 'attr' && !f?.attribute) throw new Error(`field "${name}": attribute is required for extract "attr"`);
    return { name, selector: String(f?.selector ?? ''), extract, ...(f?.attribute ? { attribute: String(f.attribute) } : {}) };
  });
  if (!fields.length) throw new Error('recipe needs at least one field');
  const names = new Set<string>();
  for (const f of fields) {
    if (names.has(f.name)) throw new Error(`duplicate field name "${f.name}"`);
    names.add(f.name);
    if (!raw.itemSelector && !f.selector) throw new Error(`field "${f.name}" needs a selector`);
  }
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    itemSelector: typeof raw.itemSelector === 'string' && raw.itemSelector.trim() ? raw.itemSelector.trim() : undefined,
    fields,
    nextSelector: typeof raw.nextSelector === 'string' && raw.nextSelector.trim() ? raw.nextSelector.trim() : undefined,
    maxPages: Math.max(1, Math.min(100, Number(raw.maxPages) || 1))
  };
}

async function ensurePicker(page: Page) {
  await page.evaluate(installPicker);
}

export async function hoverAt(page: Page, x: number, y: number): Promise<{ box: PickedBox; label: string } | null> {
  await ensurePicker(page);
  return page.evaluate(([px, py]) => (window as any).__extractorPicker.hover(px, py), [x, y] as const);
}

export async function pickAt(page: Page, x: number, y: number, itemSelector?: string): Promise<PickInfo | null> {
  await ensurePicker(page);
  return page.evaluate(([px, py, item]) => (window as any).__extractorPicker.pick(px, py, item || undefined), [x, y, itemSelector || ''] as const);
}

export async function boxesFor(page: Page, specs: { key: string; selector: string; itemSelector?: string }[]): Promise<Record<string, PickedBox[]>> {
  await ensurePicker(page);
  return page.evaluate(list => {
    const p = (window as any).__extractorPicker;
    const out: Record<string, unknown> = {};
    for (const s of list) out[s.key] = p.boxes(s.selector, s.itemSelector || undefined);
    return out;
  }, specs) as Promise<Record<string, PickedBox[]>>;
}

export async function countMatches(page: Page, selector: string, itemSelector?: string): Promise<number> {
  await ensurePicker(page);
  return page.evaluate(([s, i]) => (window as any).__extractorPicker.count(s, i || undefined), [selector, itemSelector || ''] as const);
}

async function extractPage(page: Page, recipe: Recipe, limit?: number) {
  await ensurePicker(page);
  return page.evaluate(spec => (window as any).__extractorPicker.extract(spec), {
    itemSelector: recipe.itemSelector,
    fields: recipe.fields,
    limit
  }) as Promise<Record<string, string | null>[]>;
}

/** Rows of the current page only (fast preview, no navigation). */
export async function previewRecipe(page: Page, recipe: Recipe, limit = 50): Promise<Record<string, string | null>[]> {
  return extractPage(page, recipe, limit);
}

/** Extract every page: click the "next" element between pages until maxPages or no progress. */
export async function runRecipe(page: Page, recipe: Recipe): Promise<ScrapeResult> {
  const rows: Record<string, string | null>[] = [];
  const startUrl = page.url();
  const maxPages = recipe.nextSelector ? recipe.maxPages ?? 1 : 1;
  let previous = '';
  let pages = 0;
  let stoppedBecause: ScrapeResult['stoppedBecause'] = recipe.nextSelector ? 'maxPages' : 'singlePage';

  for (let p = 1; p <= maxPages; p++) {
    const pageRows = await extractPage(page, recipe);
    const fingerprint = JSON.stringify(pageRows);
    if (p > 1 && fingerprint === previous) {
      stoppedBecause = 'noProgress';
      break;
    }
    previous = fingerprint;
    rows.push(...pageRows);
    pages = p;
    if (p === maxPages || !recipe.nextSelector) break;

    const next = page.locator(recipe.nextSelector).first();
    if (!(await next.count()) || !(await next.isVisible().catch(() => false)) || await next.isDisabled().catch(() => false)) {
      stoppedBecause = 'noNext';
      break;
    }
    debug(`Scraper: page ${p} done (${pageRows.length} rows), going to the next page`);
    await next.click({ timeout: 10000 });
    // works for full navigations and for pages that update in place
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  }
  return { rows, pages, startUrl, url: page.url(), stoppedBecause };
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

export function toCSV(rows: Record<string, string | null>[]): string {
  const columns = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const cell = (v: string | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // UTF-8 BOM so Excel shows non-Latin text (e.g. Persian) correctly
  return '﻿' + [columns.map(cell).join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** Escape a value for a Markdown table cell (pipes, line breaks, HTML tags). */
function mdCell(v: string | null | undefined): string {
  if (v == null) return '';
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

export interface MarkdownMeta {
  title?: string;
  url?: string;
  pages?: number;
  scrapedAt?: string;
}

/** GitHub-flavoured Markdown: optional title and source info, then one table with a row number column. */
export function toMarkdown(rows: Record<string, string | null>[], meta: MarkdownMeta = {}): string {
  const columns = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const lines: string[] = [];
  if (meta.title) lines.push(`# ${mdCell(meta.title)}`, '');
  const info = [
    meta.url ? `- Source: ${meta.url}` : '',
    `- Rows: ${rows.length}${meta.pages ? ` · Pages: ${meta.pages}` : ''}`,
    meta.scrapedAt ? `- Scraped: ${meta.scrapedAt}` : ''
  ].filter(Boolean);
  if (meta.title || meta.url || meta.scrapedAt) lines.push(...info, '');
  if (!columns.length) {
    lines.push('_No rows._');
    return lines.join('\n') + '\n';
  }
  lines.push(`| # | ${columns.map(mdCell).join(' | ')} |`);
  lines.push(`|---:|${columns.map(() => '---').join('|')}|`);
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${columns.map(c => mdCell(r[c])).join(' | ')} |`));
  return lines.join('\n') + '\n';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'scrape';
}

export interface SavedScrapeFiles { json: string; csv: string; md: string }

/** Save rows as JSON, CSV and Markdown in <sessionDir>/scrapes and return the session-relative paths. */
export function saveScrape(sessionDir: string, recipe: Recipe, result: ScrapeResult): SavedScrapeFiles {
  const dir = path.join(sessionDir, 'scrapes');
  ensureDir(dir);
  const base = `${slug(recipe.name || 'scrape')}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const jsonFile = path.join(dir, `${base}.json`);
  const csvFile = path.join(dir, `${base}.csv`);
  const mdFile = path.join(dir, `${base}.md`);
  const scrapedAt = new Date().toISOString();
  fs.writeFileSync(jsonFile, JSON.stringify({ recipe, startUrl: result.startUrl, url: result.url, pages: result.pages, scrapedAt, rows: result.rows }, null, 2), 'utf-8');
  fs.writeFileSync(csvFile, toCSV(result.rows), 'utf-8');
  fs.writeFileSync(mdFile, toMarkdown(result.rows, { title: recipe.name || 'Scrape', url: result.startUrl, pages: result.pages, scrapedAt }), 'utf-8');
  return { json: relPath(sessionDir, jsonFile), csv: relPath(sessionDir, csvFile), md: relPath(sessionDir, mdFile) };
}

// ---------------------------------------------------------------------------
// recipes (saved in <output>/recipes)
// ---------------------------------------------------------------------------

const recipesDir = () => path.join(OUTPUT_DIR, 'recipes');

function recipeFile(name: string): string {
  const file = path.join(recipesDir(), `${slug(name)}.json`);
  if (!file.startsWith(recipesDir() + path.sep)) throw new Error('invalid recipe name');
  return file;
}

export function listRecipes(): (Recipe & { updatedAt: string })[] {
  const dir = recipesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => {
    try {
      const file = path.join(dir, f);
      return [{ ...(JSON.parse(fs.readFileSync(file, 'utf-8')) as Recipe), updatedAt: fs.statSync(file).mtime.toISOString() }];
    } catch { return []; }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getRecipe(name: string): Recipe | null {
  const file = recipeFile(name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Recipe;
}

export function saveRecipe(raw: unknown): Recipe {
  const recipe = normalizeRecipe(raw);
  if (!recipe.name) throw new Error('recipe name is required');
  ensureDir(recipesDir());
  fs.writeFileSync(recipeFile(recipe.name), JSON.stringify(recipe, null, 2), 'utf-8');
  return recipe;
}

export function deleteRecipe(name: string): boolean {
  const file = recipeFile(name);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
