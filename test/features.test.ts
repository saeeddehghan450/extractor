/**
 * Emulation, URL blocking, HAR export, HTML report and search.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { ExtractorSession } from '../src/core/session';
import { searchSession } from '../src/core/search';
import { patternMatcher } from '../src/core/emulation';
import { COLLECTOR_NAMES } from '../src/collectors/registry';
import { startFixtureServer } from './fixtureSite';

const readJSON = (f: string) => JSON.parse(fs.readFileSync(f, 'utf-8'));
const allCollectors = () => Object.fromEntries(COLLECTOR_NAMES.map(n => [n, n !== 'memory' && n !== 'performance']));

test('block patterns: substring and wildcard', () => {
  assert.equal(patternMatcher('google-analytics')('https://www.google-analytics.com/a.js'), true);
  assert.equal(patternMatcher('*.png')('https://x.com/img/a.png'), true);
  assert.equal(patternMatcher('*.png')('https://x.com/a.png.js'), false);
  assert.equal(patternMatcher('https://*/ads/*')('https://cdn.example.com/ads/1.js'), true);
});

test('device + network emulation, headers, blocking, HAR, report and search', { timeout: 120000 }, async () => {
  const site = await startFixtureServer();
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-feat-'));
  try {
    const session = new ExtractorSession({
      url: site.url,
      headless: true,
      slowMo: 0,
      viewport: { width: 1280, height: 800 },
      performanceTraceMs: 0,
      collectors: allCollectors(),
      outputRoot,
      emulation: {
        device: 'pixel-7',
        network: 'slow-3g',
        userAgent: 'ExtractorTest/1.0',
        extraHeaders: { 'X-Extractor-Test': 'yes' },
        blockPatterns: ['/missing.png']
      }
    });
    await session.start();

    // device viewport and touch emulation
    const page = session.activePage!;
    assert.deepEqual(page.viewportSize(), { width: 412, height: 839 });
    assert.equal(await page.evaluate(() => navigator.maxTouchPoints > 0), true);
    assert.equal(await page.evaluate(() => navigator.userAgent), 'ExtractorTest/1.0');

    await page.click('#buy');
    await page.waitForFunction(() => document.getElementById('out')?.textContent === 'hello from api');
    await session.stop();

    const dir = session.dir;
    const analysis = readJSON(path.join(dir, 'analysis.json'));
    const summary = readJSON(path.join(dir, 'session.json'));

    // emulation is recorded
    assert.equal(summary.emulation.deviceLabel, 'Pixel 7');
    assert.equal(summary.emulation.networkLabel, 'Slow 3G');
    assert.deepEqual(summary.viewport, { width: 412, height: 839 });

    // extra header + custom UA are sent
    const doc = analysis.network.requests.find((r: any) => r.resourceType === 'document');
    assert.equal(doc.headers['x-extractor-test'], 'yes');
    assert.equal(doc.headers['user-agent'], 'ExtractorTest/1.0');

    // throttling: Slow 3G adds ~2 s of latency to every request
    const docResp = analysis.network.responses.find((r: any) => r.requestId === doc.id);
    assert.ok(docResp.durationMs >= 1500, `document took ${docResp.durationMs} ms`);

    // blocked request
    const img = analysis.network.requests.find((r: any) => r.url.endsWith('/missing.png'));
    assert.match(img.failure, /BLOCKED_BY_CLIENT/);
    assert.equal(summary.counts.blocked, 1);

    // HAR
    assert.equal(summary.exports.har, 'network/network.har');
    const har = readJSON(path.join(dir, 'network', 'network.har'));
    assert.equal(har.log.version, '1.2');
    assert.equal(har.log.entries.length, analysis.network.requests.length);
    const harJs = har.log.entries.find((e: any) => e.request.url.endsWith('/app.js'));
    assert.equal(harJs.response.status, 200);
    assert.ok(harJs.response.content.text.includes('buy clicked'), 'full body in HAR');
    const harApi = har.log.entries.find((e: any) => e.request.url.endsWith('/api/data'));
    assert.equal(harApi.response.content.text, '{"message":"hello from api"}');
    const harImg = har.log.entries.find((e: any) => e.request.url.endsWith('/missing.png'));
    assert.equal(harImg.response.status, 0);

    // HTML report
    assert.equal(summary.exports.report, 'report.html');
    const report = fs.readFileSync(path.join(dir, 'report.html'), 'utf-8');
    assert.ok(report.includes('<title>DevTools Extractor report · Fixture Shop</title>'));
    assert.ok(report.includes('Pixel 7'));
    assert.ok(report.includes('data:image/png;base64,'), 'screenshots embedded');
    assert.ok(report.includes('fixture uncaught error'), 'console errors listed');
    assert.ok(!/<script/i.test(report), 'report has no scripts');

    // search
    const body = searchSession(dir, analysis, 'hello from api');
    assert.ok(body.matches.some(m => m.kind === 'response' && m.title.endsWith('/api/data')));
    const src = searchSession(dir, analysis, 'buy clicked');
    assert.ok(src.matches.some(m => m.kind === 'source'), 'found in downloaded sources');
    assert.ok(src.matches.some(m => m.kind === 'console'), 'found in console');
    const store = searchSession(dir, analysis, '3 items');
    assert.ok(store.matches.some(m => m.kind === 'storage' && m.title === 'cart'));
    const hdr = searchSession(dir, analysis, 'x-frame-options: deny');
    assert.ok(hdr.matches.some(m => m.kind === 'response' && m.where === 'response header x-frame-options'));
    const re = searchSession(dir, analysis, 'hello\\s+from', { regex: true });
    assert.ok(re.matches.length > 0);
    for (const m of re.matches) assert.match(m.snippet.slice(m.start, m.end), /hello\s+from/i);
    assert.ok(searchSession(dir, analysis, '(', { regex: true }).error);
    assert.equal(searchSession(dir, analysis, 'buy', { limit: 2 }).truncated, true);
  } finally {
    await site.close();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('dashboard API: report and search endpoints', { timeout: 120000 }, async () => {
  const site = await startFixtureServer();
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-api-'));
  process.env.EXTRACTOR_OUTPUT = outputRoot;
  // the store reads EXTRACTOR_OUTPUT when it is loaded
  const { createServer } = await import('../src/server/server');
  const server = createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const session = new ExtractorSession({
      url: site.url, headless: true, slowMo: 0, viewport: { width: 800, height: 600 },
      performanceTraceMs: 0, collectors: allCollectors(), outputRoot
    });
    await session.start();
    await session.stop();
    const id = session.id;

    const fa = await fetch(`${base}/api/sessions/${id}/report?lang=fa`);
    assert.equal(fa.status, 200);
    assert.match(fa.headers.get('content-security-policy') || '', /sandbox/);
    const faHtml = await fa.text();
    assert.ok(faHtml.includes('dir="rtl"') && faHtml.includes('گزارش DevTools Extractor'));

    const dl = await fetch(`${base}/api/sessions/${id}/report?lang=en&download=1`);
    assert.match(dl.headers.get('content-disposition') || '', /attachment/);

    const search = await (await fetch(`${base}/api/sessions/${id}/search?q=rebeccapurple`)).json() as any;
    assert.ok(search.matches.some((m: any) => m.kind === 'source' || m.kind === 'response'));

    const meta = await (await fetch(`${base}/api/meta`)).json() as any;
    assert.ok(meta.devices.some((d: any) => d.key === 'iphone-15'));
    assert.ok(meta.networks.some((n: any) => n.key === 'slow-3g'));

    assert.equal((await fetch(`${base}/api/sessions/nope/search?q=x`)).status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
    await site.close();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
