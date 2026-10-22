/**
 * search.ts
 *
 * Full-text search inside a saved session: request URLs, headers, post data, response bodies,
 * console messages, cookies, web storage and the downloaded JS/CSS sources.
 */

import fs from 'fs';
import path from 'path';

export type MatchKind = 'url' | 'request' | 'response' | 'console' | 'cookie' | 'storage' | 'source';

export interface SearchMatch {
  kind: MatchKind;
  /** short label: URL, header name, file path, ... */
  title: string;
  /** where the match was found: "header content-type", "body", "line 120", ... */
  where: string;
  /** text around the match; the match itself is snippet.slice(start, end) */
  snippet: string;
  start: number;
  end: number;
  /** network request id (url / request / response matches) */
  requestId?: string;
  /** session-relative file (source / saved body matches) */
  file?: string;
}

export interface SearchResult {
  query: string;
  matches: SearchMatch[];
  truncated: boolean;
  error?: string;
}

const CONTEXT = 60;
const MAX_TEXT = 5 * 1024 * 1024;

type Matcher = (text: string) => { index: number; length: number } | null;

function makeMatcher(query: string, regex: boolean, caseSensitive: boolean): Matcher {
  if (regex) {
    const re = new RegExp(query, caseSensitive ? '' : 'i');
    return text => {
      const m = re.exec(text);
      return m && m[0].length ? { index: m.index, length: m[0].length } : null;
    };
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  return text => {
    const hay = caseSensitive ? text : text.toLowerCase();
    const index = hay.indexOf(needle);
    return index < 0 ? null : { index, length: needle.length };
  };
}

function snippetOf(text: string, index: number, length: number) {
  const from = Math.max(0, index - CONTEXT);
  const to = Math.min(text.length, index + length + CONTEXT);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  const snippet = prefix + text.slice(from, to).replace(/\s+/g, ' ') + suffix;
  // whitespace collapsing can shift positions: locate the match again inside the snippet
  const body = text.slice(index, index + length).replace(/\s+/g, ' ');
  const start = snippet.indexOf(body, prefix.length);
  return { snippet, start: start < 0 ? 0 : start, end: start < 0 ? 0 : start + body.length };
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function searchSession(
  sessionDir: string,
  analysis: any,
  query: string,
  opts: { regex?: boolean; caseSensitive?: boolean; limit?: number } = {}
): SearchResult {
  const limit = Math.min(Math.max(opts.limit ?? 300, 1), 1000);
  const result: SearchResult = { query, matches: [], truncated: false };
  if (!query.trim()) return result;

  let match: Matcher;
  try {
    match = makeMatcher(query, !!opts.regex, !!opts.caseSensitive);
  } catch (e) {
    result.error = `Invalid regular expression: ${(e as Error).message}`;
    return result;
  }

  /** Returns false once the limit is reached and at least one more match exists (= stop searching). */
  const add = (m: Omit<SearchMatch, 'snippet' | 'start' | 'end'>, text: string): boolean => {
    const found = match(text);
    if (!found) return true;
    if (result.matches.length >= limit) {
      result.truncated = true;
      return false;
    }
    result.matches.push({ ...m, ...snippetOf(text, found.index, found.length) });
    return true;
  };

  const readSessionFile = (rel: string): string | null => {
    const file = path.resolve(sessionDir, rel);
    if (!file.startsWith(path.resolve(sessionDir) + path.sep) || !fs.existsSync(file)) return null;
    if (fs.statSync(file).size > MAX_TEXT) return null;
    return fs.readFileSync(file, 'utf-8');
  };

  const a = analysis || {};
  const responses = new Map<string, any>((a.network?.responses || []).map((r: any) => [r.requestId, r]));

  // --- network ---
  for (const req of a.network?.requests || []) {
    if (!add({ kind: 'url', title: req.url, where: `${req.method} ${req.resourceType}`, requestId: req.id }, req.url)) return result;
    for (const [k, v] of Object.entries<string>(req.headers || {})) {
      if (!add({ kind: 'request', title: req.url, where: `request header ${k}`, requestId: req.id }, `${k}: ${v}`)) return result;
    }
    if (req.postData && !add({ kind: 'request', title: req.url, where: 'post data', requestId: req.id }, req.postData)) return result;

    const resp = responses.get(req.id);
    if (!resp) continue;
    for (const [k, v] of Object.entries<string>(resp.headers || {})) {
      if (!add({ kind: 'response', title: req.url, where: `response header ${k}`, requestId: req.id }, `${k}: ${v}`)) return result;
    }
    const body = resp.fullBodyPath ? readSessionFile(resp.fullBodyPath) : resp.bodySnippet;
    if (body && !body.startsWith('[non-text content')) {
      const found = match(body);
      if (found && !add({
        kind: 'response',
        title: req.url,
        where: `body, line ${lineOf(body, found.index)}`,
        requestId: req.id,
        file: resp.fullBodyPath || undefined
      }, body)) return result;
    }
  }

  // --- console ---
  for (const l of a.console?.logs || []) {
    if (!add({ kind: 'console', title: l.location?.url || '', where: l.type }, l.text || '')) return result;
  }
  for (const e of a.console?.pageErrors || []) {
    if (!add({ kind: 'console', title: '', where: 'uncaught error' }, `${e.message}\n${e.stack || ''}`)) return result;
  }

  // --- application ---
  for (const c of a.application?.cookies || []) {
    if (!add({ kind: 'cookie', title: `${c.name} (${c.domain})`, where: 'cookie' }, `${c.name}=${c.value}`)) return result;
  }
  for (const area of ['localStorage', 'sessionStorage'] as const) {
    for (const [k, v] of Object.entries<string>(a.application?.storageInfo?.[area] || {})) {
      if (!add({ kind: 'storage', title: k, where: area }, `${k}: ${v}`)) return result;
    }
  }

  // --- downloaded sources (js / css / inline code) ---
  const sourcesDir = path.join(sessionDir, 'sources');
  if (fs.existsSync(sourcesDir)) {
    const urlOf = new Map<string, string>();
    for (const s of a.scripts?.external || []) if (s.savedPath) urlOf.set(s.savedPath, s.src);
    for (const s of a.css?.stylesheets || []) if (s.savedPath) urlOf.set(s.savedPath, s.href);
    for (const name of fs.readdirSync(sourcesDir).sort()) {
      const rel = `sources/${name}`;
      const text = readSessionFile(rel);
      if (!text) continue;
      const found = match(text);
      if (!found) continue;
      if (!add({ kind: 'source', title: urlOf.get(rel) || rel, where: `line ${lineOf(text, found.index)}`, file: rel }, text)) return result;
    }
  }

  return result;
}
