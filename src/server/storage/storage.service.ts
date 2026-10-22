/**
 * storage.service.ts - PostgreSQL + SeaweedFS archive, as used by the HTTP layer.
 */

import path from 'path';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';
import { isValidSessionId } from '../../core/sessionStore';
import { contentTypeOf } from '../../storage/archive';
import { closeS3, getObjectStream, s3Status, sessionKey } from '../../storage/objectStore';
import { closePool, postgresStatus } from '../../storage/postgres';
import { autoArchiveEnabled, s3Settings } from '../../storage/settings';

@Injectable()
export class StorageService implements OnModuleDestroy {
  async status() {
    const [postgres, s3] = await Promise.all([postgresStatus(), s3Status()]);
    return { postgres, s3, autoArchive: autoArchiveEnabled() };
  }

  /** Drop connections so new settings are used. */
  async reconnect(): Promise<void> {
    await closePool();
    closeS3();
  }

  async onModuleDestroy(): Promise<void> {
    await this.reconnect();
  }

  /**
   * Serve a session file from SeaweedFS when it is not in the output folder any more.
   * Returns false when there is no archived copy.
   */
  async sendArchivedFile(res: Response, sessionId: string, rel: string, download: boolean): Promise<boolean> {
    if (!s3Settings().enabled || !isValidSessionId(sessionId)) return false;
    const clean = path.posix.normalize(rel.replace(/\\/g, '/'));
    if (!clean || clean === '.' || clean.startsWith('..') || path.posix.isAbsolute(clean)) return false;
    const obj = await getObjectStream(sessionKey(sessionId, clean)).catch(() => null);
    if (!obj) return false;
    const ext = path.extname(clean).toLowerCase();
    // same rules as local files: captured code is shown as text, saved pages are sandboxed
    const type = ['.js', '.css', '.svg', '.txt'].includes(ext) ? 'text/plain; charset=utf-8'
      : ext === '.json' || ext === '.har' ? 'application/json; charset=utf-8' : contentTypeOf(clean);
    res.status(200);
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Served-From', 'seaweedfs');
    if (obj.size != null) res.setHeader('Content-Length', obj.size);
    if (ext === '.html') res.setHeader('Content-Security-Policy', 'sandbox');
    if (download) res.setHeader('Content-Disposition', `attachment; filename="${path.posix.basename(clean).replace(/"/g, '')}"`);
    obj.body.pipe(res);
    return true;
  }
}
