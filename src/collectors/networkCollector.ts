/**
 * networkCollector.ts
 *
 * Full collection of network requests and responses for every page of a browser context.
 * Includes:
 *  - request headers and postData
 *  - response headers and body (snippet, full body saved to disk when large)
 *  - timing, size, remote address and TLS details of navigations
 */

import path from 'path';
import { BrowserContext, Request, Response } from 'playwright';
import { NetworkRequestRecord, NetworkResponseRecord } from '../types';
import { relPath, saveBodyToFile } from '../utils/fileUtils';
import { debug } from '../utils/logger';

const MAX_BODY_CHARS = 20000;          // snippet limit
const BIG_RESPONSE_THRESHOLD = 5000;   // threshold to save full body
const MAX_SAVED_BODY_BYTES = 10 * 1024 * 1024;

const TEXT_TYPES = ['application/json', 'text/', 'javascript', 'html', 'xml', '+json', 'x-www-form-urlencoded'];

export interface NetworkCollectorEvents {
  onRequest?: (r: NetworkRequestRecord) => void;
  onResponse?: (r: NetworkResponseRecord) => void;
}

let counter = 0;
const nextId = () => `${Date.now().toString(36)}-${(++counter).toString(36)}`;

/**
 * Start network listening on every page of the context
 */
export function initNetworkCollector(context: BrowserContext, sessionDir: string, events: NetworkCollectorEvents = {}) {
  const networkRequests: NetworkRequestRecord[] = [];
  const networkResponses: NetworkResponseRecord[] = [];
  const requestIds = new WeakMap<Request, NetworkRequestRecord>();
  const responseRecords = new WeakMap<Request, NetworkResponseRecord>();
  const startTimes = new WeakMap<Request, number>();
  const responsesDir = path.join(sessionDir, 'responses');

  context.on('request', request => {
    let frameUrl: string | null = null;
    try { frameUrl = request.frame().url(); } catch { /* service worker requests have no frame */ }
    const record: NetworkRequestRecord = {
      id: nextId(),
      timestamp: new Date().toISOString(),
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData(),
      resourceType: request.resourceType(),
      frameUrl,
      isNavigation: request.isNavigationRequest(),
      failure: null
    };
    requestIds.set(request, record);
    startTimes.set(request, Date.now());
    networkRequests.push(record);
    events.onRequest?.(record);
  });

  context.on('requestfailed', request => {
    const record = requestIds.get(request);
    if (record) record.failure = request.failure()?.errorText || 'failed';
  });

  context.on('response', async (response: Response) => {
    const request = response.request();
    const reqRecord = requestIds.get(request);
    const headers = response.headers();
    const contentType = (headers['content-type'] || '').toLowerCase();

    const record: NetworkResponseRecord = {
      id: nextId(),
      requestId: reqRecord?.id || '',
      timestamp: new Date().toISOString(),
      url: response.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      statusText: response.statusText(),
      headers,
      contentType,
      size: headers['content-length'] ? Number(headers['content-length']) : null,
      durationMs: null,
      fromServiceWorker: response.fromServiceWorker(),
      remoteAddress: null,
      securityDetails: null,
      bodySnippet: null,
      fullBodyPath: null
    };
    networkResponses.push(record);
    responseRecords.set(request, record);

    try {
      record.remoteAddress = await response.serverAddr().catch(() => null);
      if (request.isNavigationRequest()) {
        record.securityDetails = (await response.securityDetails().catch(() => null)) as any;
      }

      const isRedirect = record.status >= 300 && record.status < 400;
      if (isRedirect) {
        record.bodySnippet = null;
      } else if (TEXT_TYPES.some(t => contentType.includes(t))) {
        const body = await response.body().catch(() => null);
        if (body) {
          record.size = body.length;
          const txt = body.toString('utf-8');
          if (txt.length > BIG_RESPONSE_THRESHOLD && body.length <= MAX_SAVED_BODY_BYTES) {
            const ext = contentType.includes('json') ? 'json' : contentType.includes('html') ? 'html'
              : contentType.includes('css') ? 'css' : contentType.includes('javascript') ? 'js' : 'txt';
            record.fullBodyPath = relPath(sessionDir, saveBodyToFile(responsesDir, 'resp', response.url(), body, ext));
          }
          record.bodySnippet = txt.length > MAX_BODY_CHARS ? txt.substring(0, MAX_BODY_CHARS) + '\n[TRUNCATED]' : txt;
        }
      } else {
        record.bodySnippet = `[non-text content: ${contentType || 'unknown'}]`;
      }
    } catch (e) {
      record.bodySnippet = '[error reading body]';
      debug(`Error reading response body of ${response.url()}: ${(e as Error).message}`);
    }
    events.onResponse?.(record);
  });

  context.on('requestfinished', async request => {
    const record = responseRecords.get(request);
    const start = startTimes.get(request);
    if (!record) return;
    if (start) record.durationMs = Date.now() - start;
    if (record.size == null) {
      const sizes = await request.sizes().catch(() => null);
      if (sizes) record.size = sizes.responseBodySize;
    }
  });

  debug('Network collector activated');

  return { networkRequests, networkResponses };
}
