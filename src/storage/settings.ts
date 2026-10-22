/**
 * settings.ts (storage)
 *
 * Resolved settings of the long-term storage: environment variables > config.json "storage" > defaults.
 *   PostgreSQL: DATABASE_URL (or POSTGRES_URL)
 *   SeaweedFS / S3: S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION
 *   STORAGE_AUTO_ARCHIVE=0 disables archiving sessions when they finish
 */

import { loadConfig } from '../utils/configManager';

export class StorageError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface PostgresSettings {
  enabled: boolean;
  url: string;
  source: 'env' | 'config' | 'none';
}

export interface S3Settings {
  enabled: boolean;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  source: 'env' | 'config' | 'none';
}

export function postgresSettings(): PostgresSettings {
  const c = loadConfig().storage?.postgres || {};
  const envUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (envUrl) return { enabled: process.env.POSTGRES_ENABLED !== '0', url: envUrl, source: 'env' };
  return { enabled: !!c.enabled && !!c.url, url: c.url || '', source: c.enabled ? 'config' : 'none' };
}

export function s3Settings(): S3Settings {
  const c = loadConfig().storage?.s3 || {};
  const env = process.env;
  const fromEnv = !!env.S3_ENDPOINT;
  return {
    enabled: fromEnv ? env.S3_ENABLED !== '0' : !!c.enabled && !!c.endpoint,
    endpoint: (fromEnv ? env.S3_ENDPOINT : c.endpoint) || 'http://localhost:8333',
    accessKeyId: (fromEnv ? env.S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID : c.accessKeyId) || '',
    secretAccessKey: (fromEnv ? env.S3_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY : c.secretAccessKey) || '',
    bucket: (fromEnv ? env.S3_BUCKET : c.bucket) || 'extractor',
    region: (fromEnv ? env.S3_REGION : c.region) || 'us-east-1',
    source: fromEnv ? 'env' : c.enabled ? 'config' : 'none'
  };
}

export function autoArchiveEnabled(): boolean {
  const env = process.env.STORAGE_AUTO_ARCHIVE;
  if (env) return env !== '0';
  return loadConfig().storage?.autoArchive ?? true;
}

/** postgres://user:***@host:5432/db - for status pages and logs. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url ? '(invalid URL)' : '';
  }
}
