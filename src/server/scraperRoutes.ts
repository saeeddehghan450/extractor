/**
 * scraperRoutes.ts
 *
 *   POST   /api/scraper/count           {selector, itemSelector?}  -> number of matches on the current page
 *   POST   /api/scraper/preview         {recipe}                    -> rows of the current page (first 50)
 *   POST   /api/scraper/run             {recipe, save?}             -> all pages, saved as JSON + CSV
 *   GET    /api/scraper/recipes                                     -> saved recipes
 *   POST   /api/scraper/recipes         {recipe}                    -> save (name required)
 *   DELETE /api/scraper/recipes/{name}
 */

import http from 'http';
import { controller } from '../core/controller';
import {
  countMatches, deleteRecipe, listRecipes, normalizeRecipe, previewRecipe, runRecipe, saveRecipe, saveScrape
} from '../scraper/scraper';

export class ScraperRouteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function recipeFrom(body: any) {
  try {
    return normalizeRecipe(body?.recipe ?? body);
  } catch (e) {
    throw new ScraperRouteError(400, (e as Error).message);
  }
}

function activePage() {
  const session = controller.require();
  const page = session.activePage;
  if (!page) throw new ScraperRouteError(409, 'The session has no open page');
  return { session, page };
}

export async function handleScraperRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  readBody: (req: http.IncomingMessage) => Promise<any>
): Promise<boolean> {
  const p = url.pathname;
  const method = req.method || 'GET';
  if (!p.startsWith('/api/scraper/')) return false;

  if (p === '/api/scraper/count' && method === 'POST') {
    const body = await readBody(req);
    const { page } = activePage();
    const count = await countMatches(page, String(body.selector ?? ''), body.itemSelector ? String(body.itemSelector) : undefined);
    sendJSON(res, 200, { count, valid: count >= 0 });
    return true;
  }

  if (p === '/api/scraper/preview' && method === 'POST') {
    const recipe = recipeFrom(await readBody(req));
    const { page } = activePage();
    const rows = await previewRecipe(page, recipe, 50);
    sendJSON(res, 200, { rows, url: page.url() });
    return true;
  }

  if (p === '/api/scraper/run' && method === 'POST') {
    const body = await readBody(req);
    const recipe = recipeFrom(body);
    const { session, page } = activePage();
    const result = await runRecipe(page, recipe);
    const files = body.save === false ? null : saveScrape(session.dir, recipe, result);
    sendJSON(res, 200, { ...result, sessionId: session.id, files });
    return true;
  }

  if (p === '/api/scraper/recipes' && method === 'GET') {
    sendJSON(res, 200, listRecipes());
    return true;
  }

  if (p === '/api/scraper/recipes' && method === 'POST') {
    const body = await readBody(req);
    try {
      sendJSON(res, 200, saveRecipe(body?.recipe ?? body));
    } catch (e) {
      throw new ScraperRouteError(400, (e as Error).message);
    }
    return true;
  }

  const del = p.match(/^\/api\/scraper\/recipes\/(.+)$/);
  if (del && method === 'DELETE') {
    if (!deleteRecipe(decodeURIComponent(del[1]))) throw new ScraperRouteError(404, 'Recipe not found');
    sendJSON(res, 200, { ok: true });
    return true;
  }

  return false;
}
