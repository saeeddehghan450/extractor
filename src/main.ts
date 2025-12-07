/**
 * main.ts
 * 
 * Main file for the Ultimate DevTools Analyzer project
 * 
 * - Launch browser
 * - Wait for user to close browser window
 * - Collect data from all tabs
 * - Save final JSON with configurable collectors
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { info, debug, success, warn, error } from './utils/logger';
import { isCollectorEnabled, createModuleDir, ensureModuleDirs, loadConfig } from './utils/configManager';
import { initNetworkCollector } from './collectors/networkCollector';
import { collectElementInfo } from './collectors/elementsCollector';
import { collectScripts } from './collectors/scriptsCollector';
import { collectCSS } from './collectors/cssCollector';
import { collectApplicationData } from './collectors/applicationCollector';
import { collectSecurityInfo } from './collectors/securityCollector';
import { initConsoleCollector } from './collectors/consoleCollector';
import { collectPerformanceTrace } from './collectors/performanceCollector';
import { collectAccessibilityTree } from './collectors/accessibilityCollector';
import { collectMediaStats } from './collectors/mediaCollector';
import { collectWebGLDetails } from './collectors/webglCollector';
import { collectHeapSnapshot } from './collectors/memoryCollector';
import { collectServiceWorkerInfo } from './collectors/serviceWorkerCollector';
import { ClickedElementInfo } from './types';

const config = loadConfig();
const TARGET_URL = process.env.TARGET_URL || config.targetUrl;
const OUTPUT_DIR = path.resolve(process.cwd(), 'output');

// Create output directories
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(path.join(OUTPUT_DIR, 'responses'))) fs.mkdirSync(path.join(OUTPUT_DIR, 'responses'), { recursive: true });
if (!fs.existsSync(path.join(OUTPUT_DIR, 'sources'))) fs.mkdirSync(path.join(OUTPUT_DIR, 'sources'), { recursive: true });

// Create module-specific directories
ensureModuleDirs(OUTPUT_DIR);

// Log enabled collectors
info('Enabled collectors:');
Object.entries(config.collectors).forEach(([name, cfg]) => {
  const status = cfg.enabled ? '✓' : '✗';
  info(`  [${status}] ${name}: ${cfg.description}`);
});

(async () => {
  info('Launching browser...');
  const browser = await chromium.launch({ headless: config.headless, slowMo: config.slowMo });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Network (if enabled)
  let networkRequests: any[] = [];
  let networkResponses: any[] = [];
  if (isCollectorEnabled('network')) {
    const result = initNetworkCollector(page);
    networkRequests = result.networkRequests;
    networkResponses = result.networkResponses;
  }

  // Console & Errors (if enabled)
  let consoleMessages: any[] = [];
  let pageErrors: any[] = [];
  let dialogs: any[] = [];
  if (isCollectorEnabled('console')) {
    const result = initConsoleCollector(page);
    consoleMessages = result.consoleMessages;
    pageErrors = result.pageErrors;
    dialogs = result.dialogs;
  }

  // Listen for browser closure
  browser.on('disconnected', () => {
    warn('Browser was closed. Cleaning up and exiting process.');
    process.exit(0);
  });

  // Listen for page closure
  page.on('close', () => {
    warn('Page was closed. Cleaning up and exiting process.');
    process.exit(0);
  });

  try {
    // Expose a function to handle click data from the browser context
    await page.exposeFunction('saveClickData', async (clickData: ClickedElementInfo) => {
      // Quick immediate snapshot to avoid blocking page behavior (e.g., captcha)
      debug(`saveClickData called (immediate): ${JSON.stringify({ tag: clickData.tagName, id: clickData.id })}`);
      try {
        const timestamp = Date.now();
        const baseName = `click-${timestamp}`;
        const quickOutPath = path.join(OUTPUT_DIR, `${baseName}.partial.json`);

        const quickSnapshot = {
          meta: { createdAt: new Date().toISOString(), targetUrl: page.url(), click: clickData },
          note: 'partial snapshot saved immediately; full collection will follow in background'
        };

        fs.writeFileSync(quickOutPath, JSON.stringify(quickSnapshot, null, 2), 'utf-8');
        success(`Quick click snapshot saved -> ${quickOutPath}`);

        // Run heavy collectors in background without awaiting to avoid blocking page
        (async () => {
          try {
            const timestamp2 = Date.now();
            const finalBase = `click-${timestamp2}`;
            const clickOutPath = path.join(OUTPUT_DIR, `${finalBase}.json`);

            let elementInfo: any = null;
            let cdpListeners: any = null;
            if (isCollectorEnabled('elements')) {
              try { 
                const result = await collectElementInfo(page, clickData);
                elementInfo = result.elementInfo;
                cdpListeners = result.cdpListeners;
              } catch (e) { debug(`collectElementInfo failed: ${String(e)}`); }
            }

            // Run other collectors defensively
            let scriptsInfo: any = null;
            if (isCollectorEnabled('scripts')) {
              try { scriptsInfo = await collectScripts(page); } catch (e) { debug(`collectScripts failed: ${String(e)}`); }
            }

            let cssInfo: any = null;
            if (isCollectorEnabled('css')) {
              try { cssInfo = await collectCSS(page, elementInfo); } catch (e) { debug(`collectCSS failed: ${String(e)}`); }
            }

            let applicationData: any = null;
            if (isCollectorEnabled('application')) {
              try { applicationData = await collectApplicationData(page, context); } catch (e) { debug(`collectApplicationData failed: ${String(e)}`); }
            }

            let securityInfo: any = null;
            if (isCollectorEnabled('security')) {
              try { securityInfo = await collectSecurityInfo(page); } catch (e) { debug(`collectSecurityInfo failed: ${String(e)}`); }
            }

            let performanceTracePath: string | null = null;
            if (isCollectorEnabled('performance')) {
              try { performanceTracePath = await collectPerformanceTrace(page, OUTPUT_DIR); } catch (e) { debug(`collectPerformanceTrace failed: ${String(e)}`); }
            }

            let accessibilityTree: any = null;
            if (isCollectorEnabled('accessibility')) {
              try { accessibilityTree = await collectAccessibilityTree(page); } catch (e) { debug(`collectAccessibilityTree failed: ${String(e)}`); }
            }

            let mediaStats: any = null;
            if (isCollectorEnabled('media')) {
              try { mediaStats = await collectMediaStats(page); } catch (e) { debug(`collectMediaStats failed: ${String(e)}`); }
            }

            let webglDetails: any = null;
            if (isCollectorEnabled('webgl')) {
              try { webglDetails = await collectWebGLDetails(page); } catch (e) { debug(`collectWebGLDetails failed: ${String(e)}`); }
            }

            let heapSnapshot: any = null;
            if (isCollectorEnabled('memory')) {
              try { heapSnapshot = await collectHeapSnapshot(page); } catch (e) { debug(`collectHeapSnapshot failed: ${String(e)}`); }
            }

            let serviceWorkerInfo: any = null;
            if (isCollectorEnabled('serviceWorker')) {
              try { serviceWorkerInfo = await collectServiceWorkerInfo(page); } catch (e) { debug(`collectServiceWorkerInfo failed: ${String(e)}`); }
            }

            const networkSnapshot = isCollectorEnabled('network') 
              ? { requests: networkRequests.slice(), responses: networkResponses.slice() }
              : null;
            const consoleSnapshot = isCollectorEnabled('console')
              ? { logs: consoleMessages.slice(), pageErrors: pageErrors.slice(), dialogs: dialogs.slice() }
              : null;

            // Save screenshot and HTML snapshot
            const screenshotPath = path.join(OUTPUT_DIR, `${finalBase}.png`);
            try { await page.screenshot({ path: screenshotPath, fullPage: false }); } catch (e) { debug(`screenshot failed: ${String(e)}`); }
            const htmlPath = path.join(OUTPUT_DIR, `${finalBase}.html`);
            try { const html = await page.content(); fs.writeFileSync(htmlPath, html, 'utf-8'); } catch (e) { debug(`save html failed: ${String(e)}`); }

            // Also store recent network bodies (if available) into a click-specific responses folder
            if (isCollectorEnabled('network')) {
              try {
                const RECENT_NETWORK_LIMIT = 50;
                const recentResponses = networkResponses.slice(-RECENT_NETWORK_LIMIT);
                const recentRequests = networkRequests.slice(-RECENT_NETWORK_LIMIT);
                const responsesDir = path.join(OUTPUT_DIR, 'network', finalBase);
                if (!fs.existsSync(responsesDir)) fs.mkdirSync(responsesDir, { recursive: true });

                for (const resp of recentResponses) {
                  if (resp.fullBodyPath && fs.existsSync(resp.fullBodyPath)) {
                    try {
                      const src = resp.fullBodyPath;
                      const destName = `${resp.id}-${path.basename(src)}`;
                      const dest = path.join(responsesDir, destName);
                      fs.copyFileSync(src, dest);
                      resp.fullBodyPath = path.relative(OUTPUT_DIR, dest).replace(/\\/g, '/');
                    } catch (e) { debug(`copy response body failed: ${String(e)}`); }
                  }
                }
                for (const req of recentRequests) {
                  if (req.postData) {
                    try {
                      const fileName = `${req.id}-request-body.txt`;
                      const filePath = path.join(responsesDir, fileName);
                      fs.writeFileSync(filePath, req.postData, 'utf-8');
                      (req as any).postDataPath = path.relative(OUTPUT_DIR, filePath).replace(/\\/g, '/');
                    } catch (e) { debug(`save request body failed: ${String(e)}`); }
                  }
                }
              } catch (e) { debug(`storing recent network bodies failed: ${String(e)}`); }
            }

            const finalClick = {
              meta: { createdAt: new Date().toISOString(), targetUrl: page.url(), click: clickData },
              elementInfo,
              cdpListeners,
              scriptsInfo,
              cssInfo,
              applicationData,
              securityInfo,
              performanceTracePath,
              accessibilityTree,
              mediaStats,
              webglDetails,
              heapSnapshot,
              serviceWorkerInfo,
              network: networkSnapshot,
              console: consoleSnapshot,
              assets: { screenshot: screenshotPath, html: htmlPath }
            };

            fs.writeFileSync(clickOutPath, JSON.stringify(finalClick, null, 2), 'utf-8');
            success(`Full click data saved -> ${clickOutPath}`);
          } catch (e) {
            debug(`background saveClickData failed: ${String(e)}`);
          }
        })();
      } catch (e) {
        debug(`saveClickData immediate handler failed: ${String(e)}`);
      }
    });

    // Inject click listener into the page BEFORE navigation so the current document receives it
    await page.addInitScript(() => {
      console.log('Injecting click listener...');
      document.addEventListener('click', (ev) => {
        const el = ev.target as HTMLElement;
        console.log('Click detected on element:', el.tagName);
        const clickData = {
          clickedAt: new Date().toISOString(),
          tagName: el.tagName,
          id: el.id || null,
          className: el.className || null,
          innerText: (el.innerText || '').slice(0, 1000),
          attributes: (() => {
            const a: Record<string,string> = {};
            for (let i = 0; i < el.attributes.length; i++) {
              const at = el.attributes[i];
              a[at.name] = at.value;
            }
            return a;
          })(),
          cssSelectorGuess: (() => {
            if (el.id) return `#${el.id}`;
            return el.tagName.toLowerCase();
          })(),
          boundingRect: el.getBoundingClientRect ? (() => {
            const rect = el.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          })() : { x: 0, y: 0, width: 0, height: 0 }
        };
        console.log('Click data prepared:', clickData);
        try {
          // call saveClickData if present — cast to any to avoid TS error
          const w: any = window as any;
          if (typeof w.saveClickData === 'function') {
            w.saveClickData(clickData);
          } else {
            console.error('saveClickData is not defined on window.');
          }
        } catch (err) {
          console.error('Error calling saveClickData:', err);
        }
        }, true);
    });

    info(`Opening page: ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    info('Browser is open. Data will be collected after the window is closed.');

    // Fallback: ensure the click listener is attached to the current document
    try {
      await page.evaluate(() => {
        if ((window as any).__extractor_click_listener_installed) return;
        (window as any).__extractor_click_listener_installed = true;
        document.addEventListener('click', (ev) => {
          try {
            const el = ev.target as HTMLElement;
            const clickData = {
              clickedAt: new Date().toISOString(),
              tagName: el?.tagName || null,
              id: el?.id || null,
              className: el?.className || null,
              innerText: (el?.innerText || '').slice(0, 1000),
              attributes: (() => {
                const a: Record<string,string> = {};
                if (!el || !el.attributes) return a;
                for (let i = 0; i < el.attributes.length; i++) {
                  const at = el.attributes[i];
                  a[at.name] = at.value;
                }
                return a;
              })(),
              cssSelectorGuess: el?.id ? `#${el.id}` : (el?.tagName || '').toLowerCase(),
              boundingRect: el && el.getBoundingClientRect ? (() => {
                const rect = el.getBoundingClientRect();
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
              })() : { x: 0, y: 0, width: 0, height: 0 }
            };
            const w: any = window as any;
            if (typeof w.saveClickData === 'function') {
              w.saveClickData(clickData);
            }
          } catch (e) {
            // swallow
          }
        }, true);
      });
    } catch (e) {
      debug(`Could not attach fallback click listener: ${String(e)}`);
    }

    // Wait for user to close the browser window
    await new Promise<void>(resolve => {
      browser.on('disconnected', () => resolve());
    });

    // Prepare dummy click data (since user closed browser)
    const clickData: ClickedElementInfo = {
      clickedAt: new Date().toISOString(),
      tagName: '',
      id: null,
      className: null,
      innerText: null,
      attributes: {},
      cssSelectorGuess: null,
      boundingRect: { x: 0, y: 0, width: 0, height: 0 }
    };

    // Collect data based on enabled collectors
    let elementInfo: any = null;
    let cdpListeners: any = null;
    if (isCollectorEnabled('elements')) {
      const result = await collectElementInfo(page, clickData);
      elementInfo = result.elementInfo;
      cdpListeners = result.cdpListeners;
    }

    let scriptsInfo: any = null;
    if (isCollectorEnabled('scripts')) {
      scriptsInfo = await collectScripts(page);
    }

    let cssInfo: any = null;
    if (isCollectorEnabled('css')) {
      cssInfo = await collectCSS(page, elementInfo);
    }

    let applicationData: any = null;
    if (isCollectorEnabled('application')) {
      applicationData = await collectApplicationData(page, context);
    }

    let securityInfo: any = null;
    if (isCollectorEnabled('security')) {
      securityInfo = await collectSecurityInfo(page);
    }

    // Collect Performance trace
    let performanceTracePath: string | null = null;
    if (isCollectorEnabled('performance')) {
      info('Collecting Performance data...');
      performanceTracePath = await collectPerformanceTrace(page, OUTPUT_DIR);
    }

    // Collect Accessibility tree
    let accessibilityTree: any = null;
    if (isCollectorEnabled('accessibility')) {
      info('Collecting Accessibility tree...');
      accessibilityTree = await collectAccessibilityTree(page);
    }

    // Collect Media stats
    let mediaStats: any = null;
    if (isCollectorEnabled('media')) {
      info('Collecting Media stats...');
      mediaStats = await collectMediaStats(page);
    }

    // Collect WebGL/canvas details
    let webglDetails: any = null;
    if (isCollectorEnabled('webgl')) {
      info('Collecting WebGL/canvas details...');
      webglDetails = await collectWebGLDetails(page);
    }

    // Collect Heap snapshot
    let heapSnapshot: any = null;
    if (isCollectorEnabled('memory')) {
      info('Collecting Heap snapshot...');
      heapSnapshot = await collectHeapSnapshot(page);
    }

    // Collect Service Worker info
    let serviceWorkerInfo: any = null;
    if (isCollectorEnabled('serviceWorker')) {
      info('Collecting Service Worker info...');
      serviceWorkerInfo = await collectServiceWorkerInfo(page);
    }

    // Get network data if enabled
    const networkData = isCollectorEnabled('network')
      ? { requests: networkRequests, responses: networkResponses }
      : null;

    // Get console data if enabled
    const consoleData = isCollectorEnabled('console')
      ? { logs: consoleMessages, pageErrors, dialogs }
      : null;

    // Build final JSON
    const finalAnalysis: any = {
      meta: { createdAt: new Date().toISOString(), targetUrl: TARGET_URL }
    };

    // Add only enabled collectors' data
    if (isCollectorEnabled('elements')) {
      finalAnalysis.clickData = elementInfo;
      finalAnalysis.cdpListeners = cdpListeners;
    }
    if (isCollectorEnabled('network')) {
      finalAnalysis.network = networkData;
    }
    if (isCollectorEnabled('console')) {
      finalAnalysis.console = consoleData;
    }
    if (isCollectorEnabled('scripts')) {
      finalAnalysis.scriptsInfo = scriptsInfo;
    }
    if (isCollectorEnabled('css')) {
      finalAnalysis.cssInfo = cssInfo;
    }
    if (isCollectorEnabled('application')) {
      finalAnalysis.application = applicationData;
    }
    if (isCollectorEnabled('security')) {
      finalAnalysis.securityInfo = securityInfo;
    }
    if (isCollectorEnabled('performance')) {
      finalAnalysis.performanceTracePath = performanceTracePath;
    }
    if (isCollectorEnabled('accessibility')) {
      finalAnalysis.accessibilityTree = accessibilityTree;
    }
    if (isCollectorEnabled('media')) {
      finalAnalysis.mediaStats = mediaStats;
    }
    if (isCollectorEnabled('webgl')) {
      finalAnalysis.webglDetails = webglDetails;
    }
    if (isCollectorEnabled('memory')) {
      finalAnalysis.heapSnapshot = heapSnapshot;
    }
    if (isCollectorEnabled('serviceWorker')) {
      finalAnalysis.serviceWorkerInfo = serviceWorkerInfo;
    }

    // Save data to module-specific folders
    for (const [collectorName, data] of Object.entries(finalAnalysis)) {
      if (collectorName === 'meta' || data === null) continue;
      const moduleDir = createModuleDir(OUTPUT_DIR, collectorName);
      const moduleFile = path.join(moduleDir, `${collectorName}-${Date.now()}.json`);
      try {
        fs.writeFileSync(moduleFile, JSON.stringify(data, null, 2), 'utf-8');
        success(`${collectorName} data saved -> ${moduleFile}`);
      } catch (e) {
        debug(`Failed to save ${collectorName} data: ${String(e)}`);
      }
    }

    const outFile = path.join(OUTPUT_DIR, `analysis-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(finalAnalysis, null, 2), 'utf-8');
    success(`Final analysis saved -> ${outFile}`);

    await browser.close();
    success('Operation completed ✅');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    error(`An error occurred: ${errorMessage}`);
    process.exit(1);
  }
})();
