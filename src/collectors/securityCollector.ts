/**
 * securityCollector.ts
 *
 * Security-related information of the page:
 *  - isSecureContext / origin
 *  - TLS certificate details of the main document
 *  - security response headers (present / missing)
 *  - mixed content and insecure cookies
 */

import { CollectorContext } from '../types';
import { debug, warn } from '../utils/logger';

const SECURITY_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy'
];

export async function collectSecurityInfo(ctx: CollectorContext): Promise<any> {
  try {
    const pageInfo = await ctx.page.evaluate(() => ({
      isSecureContext: window.isSecureContext,
      location: window.location.href,
      origin: window.location.origin,
      protocol: window.location.protocol
    }));

    // Main document response = latest navigation response for the current URL
    const mainResponse = [...ctx.network.responses]
      .reverse()
      .find(r => r.resourceType === 'document' && r.url.split('#')[0] === pageInfo.location.split('#')[0])
      || [...ctx.network.responses].reverse().find(r => r.resourceType === 'document');

    const headers = mainResponse?.headers || {};
    const securityHeaders: Record<string, string | null> = {};
    for (const h of SECURITY_HEADERS) securityHeaders[h] = headers[h] ?? null;
    const missingHeaders = SECURITY_HEADERS.filter(h => !headers[h]);

    const mixedContent = pageInfo.protocol === 'https:'
      ? Array.from(new Set(ctx.network.requests.filter(r => r.url.startsWith('http://')).map(r => r.url))).slice(0, 200)
      : [];

    let cookieIssues: any[] = [];
    try {
      const cookies = await ctx.context.cookies();
      cookieIssues = cookies
        .filter(c => !c.secure || !c.httpOnly || c.sameSite === 'None')
        .map(c => ({ name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite }));
    } catch { /* ignore */ }

    debug('Security info collected');
    return {
      ...pageInfo,
      mainDocument: mainResponse ? { url: mainResponse.url, status: mainResponse.status, remoteAddress: mainResponse.remoteAddress } : null,
      certificate: mainResponse?.securityDetails || null,
      securityHeaders,
      missingHeaders,
      mixedContent,
      cookieIssues
    };
  } catch (e) {
    warn(`Failed to collect security info: ${(e as Error).message}`);
    return null;
  }
}
