/**
 * Interactive scraper: element picking, list detection, extraction with pagination,
 * recipes, MCP tools and the /ws/live WebSocket (screencast frames + input + picking).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { startFixtureServer } from './fixtureSite';

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-scraper-'));
process.env.EXTRACTOR_OUTPUT = outputRoot;
process.env.EXTRACTOR_CONFIG = path.join(outputRoot, 'config.json');
process.env.EXTRACTOR_HEADLESS = '1';

let m: {
  controller: typeof import('../src/core/controller').controller;
  scraper: typeof import('../src/scraper/scraper');
  createServer: typeof import('../src/server/server').createServer;
  callTool: typeof import('../src/ai/tools').callTool;
};
let site: { url: string; close: () => Promise<void> };

before(async () => {
  m = {
    controller: (await import('../src/core/controller')).controller,
    scraper: await import('../src/scraper/scraper'),
    createServer: (await import('../src/server/server')).createServer,
    callTool: (await import('../src/ai/tools')).callTool
  };
  site = await startFixtureServer();
  await m.controller.start({ url: `${site.url}products`, headless: true });
});

after(async () => {
  await m.controller.stopIfActive();
  await site.close();
  fs.rmSync(outputRoot, { recursive: true, force: true });
});

async function centerOf(selector: string) {
  const box = (await m.controller.active!.activePage!.locator(selector).first().boundingBox())!;
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

test('picking an element detects the repeating list and relative fields', async () => {
  const page = m.controller.active!.activePage!;
  const p = await centerOf('li.product >> nth=1 >> a.title');

  const hover = await m.scraper.hoverAt(page, p.x, p.y);
  assert.equal(hover!.label, 'a.title');

  const info = (await m.scraper.pickAt(page, p.x, p.y))!;
  assert.equal(info.tag, 'a');
  assert.equal(info.text, 'Phone B');
  assert.equal(info.suggestedName, 'title');
  assert.ok(info.href!.endsWith('/p/1-1'));
  assert.equal(await m.scraper.countMatches(page, info.selector), 1, 'unique selector');

  const list = info.listCandidates[0];
  assert.equal(list.count, 3);
  assert.match(list.itemSelector, /li\.product\.card$/);
  assert.equal(list.fieldSelector, 'a.title');

  // second pick inside the chosen list -> selector relative to the item
  const price = await centerOf('li.product >> nth=2 >> span.price');
  const info2 = (await m.scraper.pickAt(page, price.x, price.y, list.itemSelector))!;
  assert.deepEqual(info2.inItem, { fieldSelector: 'span.price', matches: 3 });

  const boxes = await m.scraper.boxesFor(page, [{ key: 'title', selector: 'a.title', itemSelector: list.itemSelector }]);
  assert.equal(boxes.title.length, 3);
});

test('recipe extraction follows pagination and saves CSV / JSON', async () => {
  const session = m.controller.active!;
  const page = session.activePage!;
  const recipe = m.scraper.normalizeRecipe({
    name: 'Phones',
    url: page.url(),
    itemSelector: '#list > li.product.card',
    fields: [
      { name: 'title', selector: 'a.title', extract: 'text' },
      { name: 'link', selector: 'a.title', extract: 'href' },
      { name: 'price', selector: 'span.price', extract: 'text' },
      { name: 'image', selector: 'img', extract: 'src' },
      { name: 'alt', selector: 'img', extract: 'attr', attribute: 'alt' }
    ],
    nextSelector: 'a.next',
    maxPages: 5
  });

  const preview = await m.scraper.previewRecipe(page, recipe);
  assert.equal(preview.length, 3);

  const result = await m.scraper.runRecipe(page, recipe);
  assert.equal(result.pages, 2);
  assert.equal(result.stoppedBecause, 'noNext');
  assert.equal(result.rows.length, 6);
  assert.deepEqual(result.rows.map(r => r.price), ['$100', '$200', '$300', '$400', '$500', '$600']);
  assert.ok(result.rows[0].link!.endsWith('/p/1-0'));
  assert.ok(result.rows[5].image!.endsWith('/img/2-2.png'));
  assert.equal(result.rows[5].title, 'گوشی F');

  const files = m.scraper.saveScrape(session.dir, recipe, result);
  const csv = fs.readFileSync(path.join(session.dir, files.csv), 'utf-8');
  assert.ok(csv.startsWith('﻿title,link,price,image,alt\r\n'));
  assert.ok(csv.includes('"Phone C, ""Pro"""'), 'CSV quoting');
  assert.equal(JSON.parse(fs.readFileSync(path.join(session.dir, files.json), 'utf-8')).rows.length, 6);

  // invalid recipes are rejected with a clear message
  assert.throws(() => m.scraper.normalizeRecipe({ fields: [] }), /at least one field/);
  assert.throws(() => m.scraper.normalizeRecipe({ fields: [{ name: 'a', selector: 'x', extract: 'attr' }] }), /attribute is required/);

  // saved recipe -> MCP tool runs it again from the first page
  m.scraper.saveRecipe(recipe);
  const out = await m.callTool('extractor_run_recipe', { name: 'Phones', url: `${site.url}products` });
  assert.ok(!out.isError, out.text);
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.rows, 6);
  assert.ok(fs.existsSync(path.join(session.dir, parsed.files.csv)));

  const listed = JSON.parse((await m.callTool('extractor_list_recipes', {})).text);
  assert.equal(listed[0].name, 'Phones');

  // ad-hoc scrape through MCP, single page
  await session.navigate(`${site.url}products`);
  const adhoc = JSON.parse((await m.callTool('extractor_scrape', {
    itemSelector: 'li.product', fields: [{ name: 'name', selector: 'a.title' }], maxRows: 2
  })).text);
  assert.equal(adhoc.rows, 3);
  assert.equal(adhoc.data.length, 2);
});

test('WebSocket live view: frames, input, picking, origin check', { timeout: 60000 }, async () => {
  const session = m.controller.active!;
  await session.navigate(`${site.url}products`);
  const server = m.createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live`);
  const json: any[] = [];
  const frames: Buffer[] = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) frames.push(data as Buffer);
    else json.push(JSON.parse(data.toString()));
  });
  const waitFor = async <T>(fn: () => T | undefined, ms = 15000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) throw new Error('timeout');
      await new Promise(r => setTimeout(r, 50));
    }
  };
  try {
    await new Promise(r => ws.once('open', r));
    const status = await waitFor(() => json.find(j => j.t === 'status' && j.running));
    assert.equal(status.sessionId, session.id);

    // binary frame: [uint32 header length][JSON header][JPEG]
    const frame = await waitFor(() => frames[0]);
    const headerLen = frame.readUInt32BE(0);
    const header = JSON.parse(frame.subarray(4, 4 + headerLen).toString());
    assert.equal(header.w, 1280);
    assert.equal(frame[4 + headerLen], 0xff);
    assert.equal(frame[5 + headerLen], 0xd8);

    const title = await centerOf('li.product >> nth=0 >> a.title');
    ws.send(JSON.stringify({ t: 'hover', seq: 1, x: title.x, y: title.y }));
    const hover = await waitFor(() => json.find(j => j.t === 'hover' && j.seq === 1));
    assert.equal(hover.result.label, 'a.title');

    ws.send(JSON.stringify({ t: 'pick', seq: 2, x: title.x, y: title.y }));
    const picked = await waitFor(() => json.find(j => j.t === 'picked' && j.seq === 2));
    assert.equal(picked.info.listCandidates[0].count, 3);

    ws.send(JSON.stringify({ t: 'boxes', seq: 3, specs: [{ key: 'k', selector: 'span.price', itemSelector: 'li.product' }] }));
    const boxes = await waitFor(() => json.find(j => j.t === 'boxes' && j.seq === 3));
    assert.equal(boxes.groups.k.length, 3);

    // a click sent over the socket navigates the real page
    const next = await centerOf('a.next');
    ws.send(JSON.stringify({ t: 'mouse', a: 'click', x: next.x, y: next.y }));
    const nav = await waitFor(() => json.find(j => j.t === 'navigated' && String(j.url).includes('page=2')));
    assert.ok(nav);
    await waitFor(() => (session.activePage!.url().includes('page=2') ? true : undefined));

    // another site cannot open the socket
    const evil = new WebSocket(`ws://127.0.0.1:${port}/ws/live`, { headers: { Origin: 'http://evil.example' } });
    const code = await new Promise<number>(resolve => {
      evil.on('unexpected-response', (_req, res) => resolve(res.statusCode!));
      evil.on('open', () => resolve(101));
    });
    assert.equal(code, 403);
  } finally {
    ws.close();
    server.closeAllConnections();
    server.close();
  }
});

test('scraper HTTP API: count, preview, run, recipes', async () => {
  const session = m.controller.active!;
  await session.navigate(`${site.url}products`);
  const server = m.createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (p: string, body: unknown) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await (await post('/api/scraper/count', { selector: 'span.price', itemSelector: 'li.product' })).json(), { count: 3, valid: true });
    assert.equal(((await (await post('/api/scraper/count', { selector: '[[bad' })).json()) as any).valid, false);

    const recipe = { name: 'API test', itemSelector: 'li.product', fields: [{ name: 'price', selector: 'span.price', extract: 'text' }], nextSelector: 'a.next', maxPages: 3 };
    const preview = await (await post('/api/scraper/preview', { recipe })).json() as any;
    assert.equal(preview.rows.length, 3);

    const run = await (await post('/api/scraper/run', { recipe })).json() as any;
    assert.equal(run.rows.length, 6);
    const csv = await fetch(`${base}/api/sessions/${run.sessionId}/file?path=${encodeURIComponent(run.files.csv)}`);
    assert.equal(csv.status, 200);

    assert.equal((await post('/api/scraper/recipes', { recipe })).status, 200);
    const list = await (await fetch(`${base}/api/scraper/recipes`)).json() as any[];
    assert.ok(list.some(r => r.name === 'API test'));
    assert.equal((await fetch(`${base}/api/scraper/recipes/API%20test`, { method: 'DELETE' })).status, 200);
    assert.equal((await post('/api/scraper/preview', { recipe: { fields: [] } })).status, 400);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
