/**
 * End-to-end test: run a real headless session against the fixture site.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ExtractorSession } from '../src/core/session';
import { COLLECTOR_NAMES } from '../src/collectors/registry';
import { startFixtureServer } from './fixtureSite';

const readJSON = (f: string) => JSON.parse(fs.readFileSync(f, 'utf-8'));

test('full session collects every module', { timeout: 120000 }, async () => {
  const site = await startFixtureServer();
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-test-'));
  try {
    const session = new ExtractorSession({
      url: site.url,
      headless: true,
      slowMo: 0,
      viewport: { width: 1280, height: 800 },
      performanceTraceMs: 500,
      collectors: Object.fromEntries(COLLECTOR_NAMES.map(n => [n, true])),
      outputRoot
    });
    await session.start();
    assert.equal(session.status, 'running');

    // click the button through the real page so the injected listener fires
    const clickSnap = new Promise(resolve => session.once('snapshot', resolve));
    await session.activePage!.click('#buy');
    const snap: any = await clickSnap;
    assert.equal(snap.reason, 'click');
    assert.equal(snap.click.cssSelector, '#buy');
    assert.deepEqual(snap.errors, {});

    await session.stop();
    assert.equal(session.status, 'finished');

    const dir = session.dir;
    const analysis = readJSON(path.join(dir, 'analysis.json'));
    for (const name of COLLECTOR_NAMES) {
      assert.ok(analysis[name], `analysis has ${name}`);
      assert.ok(fs.existsSync(path.join(dir, name, `${name}.json`)), `${name}/${name}.json exists`);
    }

    // network
    const urls = analysis.network.requests.map((r: any) => r.url);
    assert.ok(urls.some((u: string) => u.endsWith('/api/data')), 'fetch captured');
    const appJs = analysis.network.responses.find((r: any) => r.url.endsWith('/app.js'));
    assert.ok(appJs.fullBodyPath && fs.existsSync(path.join(dir, appJs.fullBodyPath)), 'big body saved');
    assert.ok(analysis.network.responses.some((r: any) => r.status === 404));

    // console
    assert.ok(analysis.console.logs.some((l: any) => l.text === 'buy clicked'));
    assert.ok(analysis.console.logs.some((l: any) => l.type === 'warn'));
    assert.ok(analysis.console.pageErrors.some((e: any) => e.message.includes('fixture uncaught error')));

    // clicks + element details from the click snapshot
    assert.equal(analysis.clicks.length, 1);
    const clickData = readJSON(path.join(dir, snap.file));
    assert.equal(clickData.elements.clickedElement.tagName, 'BUTTON');
    assert.ok(clickData.elements.eventListeners.some((l: any) => l.type === 'click' && l.target.startsWith('button')));
    assert.ok(clickData.elements.clickedElement.computedStyles.display);
    assert.ok(clickData.elements.clickedElement.matchedRules.some((r: any) => r.selector.includes('.btn')));
    assert.equal(clickData.css.clickedElementInlineStyle['padding-top'], '4px');

    // page state
    assert.equal(analysis.elements.overview.title, 'Fixture Shop');
    assert.equal(analysis.elements.overview.forms[0].fields[0].name, 'email');
    assert.equal(analysis.scripts.external[0].sourceMappingURL, 'app.js.map');
    assert.ok(fs.existsSync(path.join(dir, analysis.scripts.external[0].savedPath)));
    assert.equal(analysis.css.stylesheets[0].status, 200);
    assert.equal(analysis.css.customProperties['--brand'], '#123456');
    assert.equal(analysis.application.storageInfo.localStorage.cart, '3 items');
    assert.ok(analysis.application.cookies.some((c: any) => c.name === 'sid' && c.httpOnly));
    assert.equal(analysis.security.securityHeaders['x-frame-options'], 'DENY');
    assert.ok(analysis.security.missingHeaders.includes('content-security-policy'));
    assert.ok(analysis.performance.metrics.Nodes > 0);
    assert.ok(fs.existsSync(path.join(dir, analysis.performance.tracePath)), 'trace saved');
    assert.ok(analysis.accessibility.roles.button >= 1);
    assert.ok(analysis.accessibility.issues.some((i: any) => i.role === 'image'));
    assert.equal(analysis.webgl.canvases[0].contextType, 'webgl');
    assert.ok(analysis.memory.heapUsage.usedSize > 0);
    assert.ok(fs.statSync(path.join(dir, analysis.memory.heapSnapshotPath)).size > 1000, 'heap snapshot saved');
    assert.equal(analysis.serviceWorker.supported, true);
    assert.ok(Array.isArray(analysis.media));

    // the page must not have been navigated away by any collector
    assert.equal(analysis.snapshots[analysis.snapshots.length - 1].url, site.url);
    assert.equal(analysis.snapshots.length, 2);
    assert.ok(fs.existsSync(path.join(dir, analysis.snapshots[1].screenshot)));

    const manifest = readJSON(path.join(dir, 'session.json'));
    assert.equal(manifest.status, 'finished');
    assert.equal(manifest.analysisFile, 'analysis.json');
  } finally {
    await site.close();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('only enabled collectors are written', { timeout: 60000 }, async () => {
  const site = await startFixtureServer();
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-test-'));
  try {
    const collectors = Object.fromEntries(COLLECTOR_NAMES.map(n => [n, n === 'network' || n === 'security']));
    const session = new ExtractorSession({
      url: site.url, headless: true, slowMo: 0, viewport: { width: 800, height: 600 },
      performanceTraceMs: 0, collectors, outputRoot
    });
    await session.start();
    await session.stop();
    const analysis = readJSON(path.join(session.dir, 'analysis.json'));
    assert.ok(analysis.network && analysis.security);
    assert.equal(analysis.console, undefined);
    assert.equal(analysis.elements, undefined);
    assert.equal(fs.existsSync(path.join(session.dir, 'console')), false);
  } finally {
    await site.close();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
