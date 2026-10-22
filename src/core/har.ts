/**
 * har.ts
 *
 * Builds an HTTP Archive (HAR 1.2) from the recorded network data.
 * The file can be imported in Chrome DevTools (Network > Import HAR), Firefox,
 * Charles, Fiddler, Insomnia and most HAR viewers.
 */

import fs from 'fs';
import path from 'path';
import { NetworkRequestRecord, NetworkResponseRecord } from '../types';

interface HarHeader { name: string; value: string }

function headerList(headers: Record<string, string> | undefined): HarHeader[] {
  return Object.entries(headers || {}).map(([name, value]) => ({ name, value }));
}

function queryString(url: string): HarHeader[] {
  try {
    return Array.from(new URL(url).searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function cookiesFromHeader(cookie: string | undefined): { name: string; value: string }[] {
  if (!cookie) return [];
  return cookie.split(';').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? { name: part.trim(), value: '' } : { name: part.slice(0, i).trim(), value: part.slice(i + 1).trim() };
  }).filter(c => c.name);
}

/** Full response text: the saved body file when there is one, else the snippet (if it is real content). */
function responseText(resp: NetworkResponseRecord, sessionDir: string): string | undefined {
  if (resp.fullBodyPath) {
    try {
      return fs.readFileSync(path.join(sessionDir, resp.fullBodyPath), 'utf-8');
    } catch { /* fall back to the snippet */ }
  }
  const s = resp.bodySnippet;
  if (!s || s.startsWith('[non-text content') || s === '[error reading body]') return undefined;
  return s.replace(/\n\[TRUNCATED\]$/, '');
}

export interface HarSource {
  requests: NetworkRequestRecord[];
  responses: NetworkResponseRecord[];
  pageUrl: string;
  startedAt: string;
  sessionDir: string;
  creatorVersion: string;
}

export function buildHar(src: HarSource) {
  const byRequest = new Map(src.responses.map(r => [r.requestId, r]));
  const entries = src.requests.map(req => {
    const resp = byRequest.get(req.id);
    const time = resp?.durationMs ?? 0;
    const mimeType = resp?.contentType || 'x-unknown';
    const text = resp ? responseText(resp, src.sessionDir) : undefined;
    const reqContentType = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || 'application/octet-stream';

    return {
      pageref: 'page_1',
      startedDateTime: req.timestamp,
      time,
      request: {
        method: req.method,
        url: req.url,
        httpVersion: 'HTTP/1.1',
        cookies: cookiesFromHeader(req.headers.cookie),
        headers: headerList(req.headers),
        queryString: queryString(req.url),
        ...(req.postData ? { postData: { mimeType: reqContentType, text: req.postData } } : {}),
        headersSize: -1,
        bodySize: req.postData ? Buffer.byteLength(req.postData) : 0
      },
      response: resp
        ? {
            status: resp.status,
            statusText: resp.statusText,
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: headerList(resp.headers),
            content: {
              size: resp.size ?? (text ? Buffer.byteLength(text) : 0),
              mimeType,
              ...(text !== undefined ? { text } : {})
            },
            redirectURL: resp.headers.location || '',
            headersSize: -1,
            bodySize: resp.size ?? -1
          }
        : {
            // failed / blocked / unfinished request
            status: 0,
            statusText: '',
            httpVersion: '',
            cookies: [],
            headers: [],
            content: { size: 0, mimeType: 'x-unknown' },
            redirectURL: '',
            headersSize: -1,
            bodySize: -1,
            _error: req.failure || 'no response'
          },
      cache: {},
      timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: time, receive: 0 },
      ...(resp?.remoteAddress ? { serverIPAddress: resp.remoteAddress.ipAddress } : {}),
      _resourceType: req.resourceType
    };
  });

  return {
    log: {
      version: '1.2',
      creator: { name: 'Ultimate DevTools Extractor', version: src.creatorVersion },
      pages: [{
        startedDateTime: src.startedAt,
        id: 'page_1',
        title: src.pageUrl,
        pageTimings: { onContentLoad: -1, onLoad: -1 }
      }],
      entries
    }
  };
}
