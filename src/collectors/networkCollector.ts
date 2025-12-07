/**
 * networkCollector.ts
 * 
 * Full collection of network requests and responses.
 * Includes:
 *  - request headers and postData
 *  - response headers and body (snippet or full)
 *  - initiator chain
 *  - HAR-like structure
 */

import { Page, Response } from 'playwright';
import { NetworkRequestRecord, NetworkResponseRecord } from '../types';
import { saveBodyToFile } from '../utils/fileUtils';
import { debug, warn } from '../utils/logger';

const MAX_BODY_CHARS = 20000;        // snippet limit
const BIG_RESPONSE_THRESHOLD = 5000; // threshold to save full body

/**
 * Start network listening on the page
 * @param page Playwright Page
 */
export function initNetworkCollector(page: Page) {
  const networkRequests: NetworkRequestRecord[] = [];
  const networkResponses: NetworkResponseRecord[] = [];

  // Listen to requests
  page.on('request', request => {
    networkRequests.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData(),
      resourceType: request.resourceType()
    });
  });

  // Listen to responses
  page.on('response', async (response: Response) => {
    try {
      const headers = response.headers();
      const contentType = (headers['content-type'] || '').toLowerCase();
      let bodySnippet: string | null = null;
      let fullBodyPath: string | null = null;

      if (contentType.includes('application/json') ||
          contentType.includes('text/') ||
          contentType.includes('javascript') ||
          contentType.includes('html')) {
        const txt = await response.text().catch(() => null);
        if (txt != null) {
          if (txt.length > BIG_RESPONSE_THRESHOLD) {
            fullBodyPath = saveBodyToFile('output/responses', 'resp', response.url(), txt);
          }
          bodySnippet = txt.substring(0, MAX_BODY_CHARS);
          if (txt.length > MAX_BODY_CHARS) bodySnippet += `\n[TRUNCATED]`;
        }
      } else {
        bodySnippet = `[non-text content: ${contentType}]`;
      }

      networkResponses.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers,
        bodySnippet,
        fullBodyPath
      });
    } catch (e) {
      networkResponses.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        bodySnippet: `[error reading body]`,
        fullBodyPath: null
      });
      warn(`Error reading response body: ${(e as Error).message}`);
    }
  });

  debug('Network collector activated');

  return { networkRequests, networkResponses };
}
