/**
 * securityCollector.ts
 * 
 * Collect security-related information of the page.
 * Includes:
 *  - isSecureContext
 *  - location / origin
 *  - certificate information (if available)
 */

import { Page } from 'playwright';
import { debug, warn } from '../utils/logger';

export interface SecurityInfo {
  isSecureContext: boolean;
  location: string;
  origin: string;
}

export async function collectSecurityInfo(page: Page): Promise<SecurityInfo> {
  try {
    const securityInfo: SecurityInfo = await page.evaluate(() => ({
      isSecureContext: window.isSecureContext,
      location: window.location.href,
      origin: window.location.origin
    }));

    debug('Security info collected');
    return securityInfo;
  } catch (e) {
    warn(`Failed to collect security info: ${(e as Error).message}`);
    return { isSecureContext: false, location: '', origin: '' };
  }
}
