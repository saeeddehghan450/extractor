/**
 * sessions.controller.ts - saved sessions
 *
 *   GET    /api/sessions
 *   GET    /api/sessions/:id
 *   DELETE /api/sessions/:id
 *   GET    /api/sessions/:id/files
 *   GET    /api/sessions/:id/file?path=&download=1     (falls back to SeaweedFS for archived sessions)
 *   GET    /api/sessions/:id/report?lang=en|fa&download=1
 *   GET    /api/sessions/:id/search?q=&regex=1&case=1&limit=
 */

import path from 'path';
import { BadRequestException, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { controller } from '../../core/controller';
import { ReportLang, renderReport } from '../../core/report';
import { searchSession } from '../../core/search';
import { deleteSession, getSession, isValidSessionId, listSessionFiles, listSessions, resolveSessionFile, sessionDir } from '../../core/sessionStore';
import { readJSON } from '../../utils/fileUtils';
import { sendSessionFile } from '../common/files';
import { StorageService } from '../storage/storage.service';

function checkId(id: string): string {
  if (!isValidSessionId(id)) throw new BadRequestException('Invalid session id');
  return id;
}

function analysisOf(id: string) {
  const dir = sessionDir(id);
  const analysis = readJSON(path.join(dir, 'analysis.json'));
  if (!analysis) throw new NotFoundException('This session has no analysis.json yet');
  return { dir, analysis };
}

@Controller('api/sessions')
export class SessionsController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get()
  list() {
    return listSessions();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    checkId(id);
    const current = controller.current;
    const s = current?.id === id ? current.summary() : getSession(id);
    if (!s) throw new NotFoundException('Session not found');
    return s;
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    checkId(id);
    const current = controller.current;
    if (current?.id === id && current.isActive) throw new ConflictException('Stop the session before deleting it');
    if (!deleteSession(id)) throw new NotFoundException('Session not found');
    return { ok: true };
  }

  @Get(':id/files')
  files(@Param('id') id: string) {
    return listSessionFiles(checkId(id));
  }

  @Get(':id/file')
  async file(@Param('id') id: string, @Query('path') rel = '', @Query('download') download: string | undefined, @Res() res: Response) {
    checkId(id);
    const file = resolveSessionFile(id, String(rel));
    if (file) return sendSessionFile(res, file, download === '1');
    // archived sessions whose local copy was removed are served from SeaweedFS
    if (await this.storage.sendArchivedFile(res, id, String(rel), download === '1')) return;
    throw new NotFoundException('File not found');
  }

  @Get(':id/search')
  search(@Param('id') id: string, @Query() q: Record<string, string | undefined>) {
    const { dir, analysis } = analysisOf(checkId(id));
    return searchSession(dir, analysis, String(q.q || '').slice(0, 500), {
      regex: q.regex === '1',
      caseSensitive: q.case === '1',
      limit: Number(q.limit) || undefined
    });
  }

  @Get(':id/report')
  report(@Param('id') id: string, @Query('lang') langParam: string | undefined, @Query('download') download: string | undefined, @Res() res: Response) {
    const { dir, analysis } = analysisOf(checkId(id));
    const lang: ReportLang = langParam === 'fa' ? 'fa' : 'en';
    const html = renderReport(analysis, readJSON(path.join(dir, 'session.json')), dir, lang);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(html));
    // the report needs no scripts; it may contain text captured from untrusted pages
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    if (download === '1') res.setHeader('Content-Disposition', `attachment; filename="report-${id}.html"`);
    res.end(html);
  }
}
