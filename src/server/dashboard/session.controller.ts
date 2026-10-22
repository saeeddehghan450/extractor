/**
 * session.controller.ts - the running session
 *
 *   GET  /api/session              summary (null when there is none)
 *   GET  /api/session/live         summary + last requests, console lines and clicks
 *   GET  /api/session/har          HAR 1.2 of the running session
 *   GET  /api/session/screenshot   JPEG of the page
 *   GET  /api/session/request/:id  one request with its response
 *   POST /api/session/start        {url, headless, collectors, emulation}
 *   POST /api/session/snapshot
 *   POST /api/session/stop
 *   POST /api/session/input        {action: click|scroll|type|press|navigate|back|forward|reload, ...}
 */

import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { controller } from '../../core/controller';
import { buildHar } from '../../core/har';
import { packageVersion } from '../../core/session';
import { compactRequest, compactResponse } from '../events/events.service';

@Controller('api/session')
export class SessionController {
  @Get()
  summary(@Res() res: Response) {
    // an explicit JSON null (Nest would send an empty body)
    res.json(controller.current ? controller.current.summary() : null);
  }

  @Get('live')
  live(@Res() res: Response) {
    const current = controller.current;
    if (!current) return void res.json(null);
    const responses = new Map(current.network.responses.map(r => [r.requestId, r]));
    const requests = current.network.requests.slice(-1000).map(r => {
      const resp = responses.get(r.id);
      return { ...compactRequest(r), response: resp ? compactResponse(resp) : null, failure: r.failure };
    });
    const consoleLines = [
      ...current.consoleData.logs.map(m => ({ ...m })),
      ...current.consoleData.pageErrors.map(e => ({ timestamp: e.timestamp, type: 'error', text: e.message, stack: e.stack, pageError: true }))
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-1000);
    res.json({ summary: current.summary(), requests, console: consoleLines, clicks: current.clicks.slice(-200) });
  }

  @Get('har')
  har(@Res() res: Response) {
    const current = controller.current;
    if (!current) throw new NotFoundException('No session');
    const har = buildHar({
      requests: current.network.requests,
      responses: current.network.responses,
      pageUrl: current.options.url,
      startedAt: current.startedAt,
      sessionDir: current.dir,
      creatorVersion: packageVersion()
    });
    res.setHeader('Content-Disposition', `attachment; filename="${current.id}.har"`);
    res.type('application/json').send(JSON.stringify(har, null, 2));
  }

  @Get('screenshot')
  async screenshot(@Res() res: Response) {
    const img = await controller.require().screenshot();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', img.length);
    res.end(img);
  }

  @Get('request/:id')
  request(@Param('id') id: string) {
    const current = controller.current;
    if (!current) throw new NotFoundException('No session');
    const request = current.network.requests.find(r => r.id === id) || null;
    const response = current.network.responses.find(r => r.requestId === id || r.id === id) || null;
    if (!request && !response) throw new NotFoundException('Request not found');
    return { request, response };
  }

  @HttpCode(200)
  @Post('start')
  async start(@Body() body: any) {
    const session = await controller.start({
      url: body?.url,
      headless: body?.headless,
      collectors: body?.collectors,
      emulation: body?.emulation
    });
    return session.summary();
  }

  @HttpCode(200)
  @Post('snapshot')
  snapshot() {
    return controller.require().snapshot('manual');
  }

  @HttpCode(200)
  @Post('stop')
  async stop() {
    const s = controller.require();
    await s.stop();
    return s.summary();
  }

  @HttpCode(200)
  @Post('input')
  async input(@Body() body: any) {
    const s = controller.require();
    switch (body?.action) {
      case 'click': await s.click(Number(body.x), Number(body.y)); break;
      case 'scroll': await s.scroll(Number(body.deltaY) || 0); break;
      case 'type': await s.type(String(body.text ?? '')); break;
      case 'press': await s.press(String(body.key)); break;
      case 'navigate': await s.navigate(String(body.url)); break;
      case 'back':
      case 'forward':
      case 'reload': await s.history(body.action); break;
      default: throw new BadRequestException('Unknown action');
    }
    return { ok: true, url: s.activePage?.url() ?? null };
  }
}
