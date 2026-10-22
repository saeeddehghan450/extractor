/**
 * scraper.controller.ts
 *
 *   POST   /api/scraper/count           {selector, itemSelector?}  -> number of matches on the current page
 *   POST   /api/scraper/preview         {recipe}                    -> rows of the current page (first 50)
 *   POST   /api/scraper/run             {recipe, save?}             -> all pages, saved as JSON + CSV + Markdown
 *   GET    /api/scraper/recipes                                     -> saved recipes
 *   POST   /api/scraper/recipes         {recipe}                    -> save (name required)
 *   DELETE /api/scraper/recipes/:name
 */

import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { controller } from '../../core/controller';
import { syncInBackground } from '../../graph/sync';
import { countMatches, deleteRecipe, listRecipes, normalizeRecipe, previewRecipe, runRecipe, saveRecipe, saveScrape } from '../../scraper/scraper';

function recipeFrom(body: any) {
  try {
    return normalizeRecipe(body?.recipe ?? body);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}

function activePage() {
  const session = controller.require();
  const page = session.activePage;
  if (!page) throw new ConflictException('The session has no open page');
  return { session, page };
}

@Controller('api/scraper')
export class ScraperController {
  @HttpCode(200)
  @Post('count')
  async count(@Body() body: any) {
    const { page } = activePage();
    const count = await countMatches(page, String(body?.selector ?? ''), body?.itemSelector ? String(body.itemSelector) : undefined);
    return { count, valid: count >= 0 };
  }

  @HttpCode(200)
  @Post('preview')
  async preview(@Body() body: any) {
    const recipe = recipeFrom(body);
    const { page } = activePage();
    return { rows: await previewRecipe(page, recipe, 50), url: page.url() };
  }

  @HttpCode(200)
  @Post('run')
  async run(@Body() body: any) {
    const recipe = recipeFrom(body);
    const { session, page } = activePage();
    const result = await runRecipe(page, recipe);
    const files = body?.save === false ? null : saveScrape(session.dir, recipe, result);
    if (files) syncInBackground(session.id, 'scrape saved');
    return { ...result, sessionId: session.id, files };
  }

  @Get('recipes')
  recipes() {
    return listRecipes();
  }

  @HttpCode(200)
  @Post('recipes')
  save(@Body() body: any) {
    try {
      return saveRecipe(body?.recipe ?? body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Delete('recipes/*name')
  remove(@Param('name') name: string | string[]) {
    const recipe = Array.isArray(name) ? name.join('/') : name;
    if (!deleteRecipe(recipe)) throw new NotFoundException('Recipe not found');
    return { ok: true };
  }
}
