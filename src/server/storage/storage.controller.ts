/**
 * storage.controller.ts - long-term storage (PostgreSQL + SeaweedFS)
 *
 *   GET    /api/storage/status                     status (never passwords / secrets)
 *   PUT    /api/storage/config   {postgres: {enabled, url}, s3: {enabled, endpoint, accessKeyId, secretAccessKey, bucket, region}, autoArchive}
 *   POST   /api/storage/archive  {sessionId?, removeLocal?} | {all: true}
 *   GET    /api/storage/sessions                    archived sessions
 *   POST   /api/storage/restore  {sessionId, overwrite?}
 *   DELETE /api/storage/sessions/:id                remove from PostgreSQL and SeaweedFS
 *   POST   /api/storage/sql      {sql, params?, limit?}   read-only
 *   GET    /api/storage/schema
 */

import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { isValidSessionId } from '../../core/sessionStore';
import { archiveAll, archiveSession, deleteArchived, listArchived, restoreSession } from '../../storage/archive';
import { SQL_SCHEMA, runReadOnlySql } from '../../storage/postgres';
import { updateConfig } from '../../utils/configManager';
import { StorageService } from './storage.service';

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

function sessionIdOf(v: unknown): string {
  const id = String(v ?? '');
  if (!isValidSessionId(id)) throw new BadRequestException('Invalid session id');
  return id;
}

@Controller('api/storage')
export class StorageController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Get('status')
  status() {
    return this.storage.status();
  }

  @Put('config')
  async config(@Body() body: any) {
    const pg = body?.postgres && typeof body.postgres === 'object' ? body.postgres : undefined;
    const s3 = body?.s3 && typeof body.s3 === 'object' ? body.s3 : undefined;
    if (pg && typeof pg.url === 'string' && pg.url.trim() && !/^postgres(ql)?:\/\/\S+$/i.test(pg.url.trim())) {
      throw new BadRequestException('The PostgreSQL URL must look like postgres://user:password@host:5432/database');
    }
    if (s3 && typeof s3.endpoint === 'string' && s3.endpoint.trim() && !/^https?:\/\/\S+$/i.test(s3.endpoint.trim())) {
      throw new BadRequestException('The S3 endpoint must be an http(s) URL, e.g. http://localhost:8333');
    }
    if (s3 && typeof s3.bucket === 'string' && s3.bucket.trim() && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(s3.bucket.trim())) {
      throw new BadRequestException('Invalid bucket name (3-63 lower-case letters, digits, dots and dashes)');
    }
    updateConfig({
      storage: {
        autoArchive: bool(body?.autoArchive),
        postgres: pg ? { enabled: bool(pg.enabled), url: pg.url === null ? null : str(pg.url) } : undefined,
        s3: s3 ? {
          enabled: bool(s3.enabled), endpoint: str(s3.endpoint), accessKeyId: str(s3.accessKeyId), bucket: str(s3.bucket), region: str(s3.region),
          secretAccessKey: s3.secretAccessKey === null ? null : str(s3.secretAccessKey)
        } : undefined
      }
    });
    await this.storage.reconnect();
    return this.storage.status();
  }

  @HttpCode(200)
  @Post('archive')
  archive(@Body() body: any) {
    if (body?.all) return archiveAll();
    return archiveSession(typeof body?.sessionId === 'string' && body.sessionId ? body.sessionId : undefined, { removeLocal: body?.removeLocal === true });
  }

  @Get('sessions')
  sessions(@Query('limit') limit?: string) {
    return listArchived(Number(limit) || 200);
  }

  @Delete('sessions/:id')
  async forget(@Param('id') id: string) {
    await deleteArchived(sessionIdOf(id));
    return { ok: true };
  }

  @HttpCode(200)
  @Post('restore')
  restore(@Body() body: any) {
    return restoreSession(sessionIdOf(body?.sessionId), { overwrite: body?.overwrite === true });
  }

  @HttpCode(200)
  @Post('sql')
  sql(@Body() body: any) {
    const params = Array.isArray(body?.params) ? body.params : [];
    return runReadOnlySql(String(body?.sql ?? ''), params, { limit: Number(body?.limit) || 500 });
  }

  @Get('schema')
  schema() {
    return { schema: SQL_SCHEMA };
  }
}
