/**
 * emulation.ts
 *
 * Device emulation, network throttling, custom User-Agent / headers and URL blocking
 * for an extraction session.
 */

import { BrowserContext, BrowserContextOptions, CDPSession, devices } from 'playwright';
import { debug } from '../utils/logger';

export interface EmulationOptions {
  /** key of DEVICE_PRESETS */
  device: string;
  /** key of NETWORK_PRESETS */
  network: string;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  /** URL patterns to block: plain text = "URL contains", with `*` = whole-URL wildcard pattern */
  blockPatterns?: string[];
}

export const DEFAULT_EMULATION: EmulationOptions = {
  device: 'desktop',
  network: 'none',
  userAgent: '',
  extraHeaders: {},
  blockPatterns: []
};

export interface DevicePreset {
  label: string;
  /** Playwright device descriptor name; null = desktop with the configured viewport */
  descriptor: string | null;
}

export const DEVICE_PRESETS: Record<string, DevicePreset> = {
  desktop: { label: 'Desktop', descriptor: null },
  'iphone-15': { label: 'iPhone 15', descriptor: 'iPhone 15' },
  'iphone-15-pro-max': { label: 'iPhone 15 Pro Max', descriptor: 'iPhone 15 Pro Max' },
  'iphone-se': { label: 'iPhone SE', descriptor: 'iPhone SE' },
  'pixel-7': { label: 'Pixel 7', descriptor: 'Pixel 7' },
  'galaxy-s9': { label: 'Galaxy S9+', descriptor: 'Galaxy S9+' },
  'ipad': { label: 'iPad (gen 7)', descriptor: 'iPad (gen 7)' },
  'ipad-pro-11': { label: 'iPad Pro 11', descriptor: 'iPad Pro 11' },
  'galaxy-tab-s4': { label: 'Galaxy Tab S4', descriptor: 'Galaxy Tab S4' }
};

export interface NetworkPreset {
  label: string;
  offline: boolean;
  /** milliseconds */
  latency: number;
  /** bytes per second, -1 = unlimited */
  download: number;
  upload: number;
}

// Same values as the Chrome DevTools throttling presets
export const NETWORK_PRESETS: Record<string, NetworkPreset> = {
  none: { label: 'No throttling', offline: false, latency: 0, download: -1, upload: -1 },
  'fast-4g': { label: 'Fast 4G', offline: false, latency: 60 * 2.75, download: (9 * 1000 * 1000) / 8 * 0.9, upload: (1.5 * 1000 * 1000) / 8 * 0.9 },
  'slow-4g': { label: 'Slow 4G', offline: false, latency: 150 * 3.75, download: (1.6 * 1000 * 1000) / 8 * 0.9, upload: (750 * 1000) / 8 * 0.9 },
  'slow-3g': { label: 'Slow 3G', offline: false, latency: 400 * 5, download: (500 * 1000) / 8 * 0.8, upload: (500 * 1000) / 8 * 0.8 },
  offline: { label: 'Offline', offline: true, latency: 0, download: -1, upload: -1 }
};

/** Validate / fill in user supplied emulation options. Unknown presets fall back to the defaults. */
export function normalizeEmulation(raw: Partial<EmulationOptions> | undefined | null): EmulationOptions {
  const r = raw || {};
  const headers: Record<string, string> = {};
  if (r.extraHeaders && typeof r.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(r.extraHeaders)) {
      const name = String(k).trim();
      // header names: RFC 7230 token characters only
      if (name && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) headers[name] = String(v ?? '').trim();
    }
  }
  return {
    device: typeof r.device === 'string' && DEVICE_PRESETS[r.device] ? r.device : DEFAULT_EMULATION.device,
    network: typeof r.network === 'string' && NETWORK_PRESETS[r.network] ? r.network : DEFAULT_EMULATION.network,
    userAgent: typeof r.userAgent === 'string' ? r.userAgent.trim() : '',
    extraHeaders: headers,
    blockPatterns: Array.isArray(r.blockPatterns)
      ? r.blockPatterns.map(p => String(p).trim()).filter(Boolean).slice(0, 200)
      : []
  };
}

/** Browser context options for the chosen device (viewport, touch, scale factor, UA, headers). */
export function contextOptions(emu: EmulationOptions, desktopViewport: { width: number; height: number }): BrowserContextOptions {
  const preset = DEVICE_PRESETS[emu.device] || DEVICE_PRESETS.desktop;
  let opts: BrowserContextOptions = { viewport: desktopViewport };
  if (preset.descriptor && devices[preset.descriptor]) {
    // defaultBrowserType is only a hint for test runners; the session always uses Chromium
    const { defaultBrowserType: _ignored, ...descriptor } = devices[preset.descriptor];
    opts = { ...descriptor };
  }
  if (emu.userAgent) opts.userAgent = emu.userAgent;
  if (emu.extraHeaders && Object.keys(emu.extraHeaders).length) opts.extraHTTPHeaders = emu.extraHeaders;
  if (NETWORK_PRESETS[emu.network]?.offline) opts.offline = true;
  return opts;
}

/** Throttle a page through CDP (offline mode is handled by the context itself). */
export async function applyNetworkConditions(cdp: CDPSession | null, emu: EmulationOptions): Promise<void> {
  const preset = NETWORK_PRESETS[emu.network];
  if (!cdp || !preset || emu.network === 'none' || preset.offline) return;
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: preset.latency,
    downloadThroughput: preset.download,
    uploadThroughput: preset.upload
  });
  debug(`Network throttling applied: ${preset.label}`);
}

/** Turn a block pattern into a matcher: with `*` it is a whole-URL wildcard pattern, otherwise "URL contains". */
export function patternMatcher(pattern: string): (url: string) => boolean {
  if (!pattern.includes('*')) {
    const needle = pattern.toLowerCase();
    return url => url.toLowerCase().includes(needle);
  }
  // wildcard patterns match the whole URL (like a glob): "*.png" does not match "a.png.js"
  const body = pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  const re = new RegExp(`^${body}$`, 'i');
  return url => re.test(url);
}

/** Abort every request whose URL matches one of the patterns. */
export async function installBlocking(context: BrowserContext, patterns: string[], onBlocked: (url: string) => void): Promise<void> {
  if (!patterns.length) return;
  const matchers = patterns.map(patternMatcher);
  await context.route('**/*', route => {
    const url = route.request().url();
    if (matchers.some(m => m(url))) {
      onBlocked(url);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}

export function describeEmulation(emu: EmulationOptions) {
  return {
    device: emu.device,
    deviceLabel: (DEVICE_PRESETS[emu.device] || DEVICE_PRESETS.desktop).label,
    network: emu.network,
    networkLabel: (NETWORK_PRESETS[emu.network] || NETWORK_PRESETS.none).label,
    userAgent: emu.userAgent || null,
    extraHeaders: Object.keys(emu.extraHeaders || {}),
    blockPatterns: emu.blockPatterns || []
  };
}
