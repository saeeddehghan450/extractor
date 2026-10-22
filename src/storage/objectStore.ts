/**
 * objectStore.ts
 *
 * Files in SeaweedFS through its S3 gateway (official AWS SDK; any S3-compatible store works).
 * Session files are stored as  <bucket>/sessions/<sessionId>/<relative path>.
 */

import fs from 'fs';
import { Readable } from 'stream';
import {
  CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client
} from '@aws-sdk/client-s3';
import { debug } from '../utils/logger';
import { S3Settings, StorageError, s3Settings } from './settings';

let client: S3Client | null = null;
let clientKey = '';
let bucketReady = '';

export function getS3(): { s3: S3Client; bucket: string; settings: S3Settings } {
  const s = s3Settings();
  if (!s.enabled) throw new StorageError(409, 'SeaweedFS (S3) is not configured - set it up on the Storage page or with S3_ENDPOINT');
  const key = JSON.stringify([s.endpoint, s.accessKeyId, s.secretAccessKey, s.region]);
  if (!client || key !== clientKey) {
    client?.destroy();
    client = new S3Client({
      endpoint: s.endpoint,
      region: s.region,
      forcePathStyle: true,
      credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
      // SeaweedFS does not need the newer default checksums
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    });
    clientKey = key;
    bucketReady = '';
    debug(`S3 client created for ${s.endpoint}`);
  }
  return { s3: client, bucket: s.bucket, settings: s };
}

export function closeS3(): void {
  client?.destroy();
  client = null;
  clientKey = '';
  bucketReady = '';
}

export function cleanS3Error(e: unknown): string {
  const err = e as { name?: string; message?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  const msg = (err.message || String(e)).split('\n')[0];
  if (err.name === 'InvalidAccessKeyId' || err.name === 'SignatureDoesNotMatch' || err.$metadata?.httpStatusCode === 403) {
    return 'SeaweedFS rejected the access key or secret';
  }
  if (err.code === 'ECONNREFUSED' || /ECONNREFUSED|ENOTFOUND/i.test(msg)) return `Cannot reach SeaweedFS: ${msg}`;
  return msg || err.name || 'S3 error';
}

export async function ensureBucket(): Promise<void> {
  const { s3, bucket } = getS3();
  if (bucketReady === clientKey + bucket) return;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw e;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  bucketReady = clientKey + bucket;
}

export const sessionKey = (sessionId: string, rel = '') => `sessions/${sessionId}/${rel}`;

export async function putFile(key: string, file: string, contentType: string): Promise<void> {
  const { s3, bucket } = getS3();
  const size = fs.statSync(file).size;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: fs.createReadStream(file), ContentLength: size, ContentType: contentType }));
}

export async function getObjectStream(key: string): Promise<{ body: Readable; size?: number; contentType?: string } | null> {
  const { s3, bucket } = getS3();
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return { body: r.Body as Readable, size: r.ContentLength, contentType: r.ContentType };
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (e as Error).name === 'NoSuchKey') return null;
    throw e;
  }
}

export async function downloadTo(key: string, file: string): Promise<boolean> {
  const obj = await getObjectStream(key);
  if (!obj) return false;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(file);
    obj.body.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve());
    obj.body.pipe(out);
  });
  return true;
}

export interface ObjectEntry { key: string; size: number }

export async function listObjects(prefix: string, delimiter?: string): Promise<{ objects: ObjectEntry[]; prefixes: string[] }> {
  const { s3, bucket } = getS3();
  const objects: ObjectEntry[] = [];
  const prefixes: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: delimiter, ContinuationToken: token }));
    for (const o of r.Contents || []) if (o.Key) objects.push({ key: o.Key, size: o.Size ?? 0 });
    for (const p of r.CommonPrefixes || []) if (p.Prefix) prefixes.push(p.Prefix);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return { objects, prefixes };
}

export async function deleteKeys(keys: string[]): Promise<void> {
  const { s3, bucket } = getS3();
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true } }));
  }
}

export interface S3Status {
  enabled: boolean;
  connected: boolean;
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  hasSecret: boolean;
  source: S3Settings['source'];
  error?: string;
  objects?: number;
  bytes?: number;
  sessions?: number;
}

export async function s3Status(): Promise<S3Status> {
  const s = s3Settings();
  const base: S3Status = {
    enabled: s.enabled, connected: false, endpoint: s.endpoint, bucket: s.bucket, region: s.region,
    accessKeyId: s.accessKeyId, hasSecret: !!s.secretAccessKey, source: s.source
  };
  if (!s.enabled) return base;
  try {
    await ensureBucket();
    const { objects } = await listObjects('sessions/');
    const sessions = new Set(objects.map(o => o.key.split('/')[1]));
    return { ...base, connected: true, objects: objects.length, bytes: objects.reduce((n, o) => n + o.size, 0), sessions: sessions.size };
  } catch (e) {
    return { ...base, error: cleanS3Error(e) };
  }
}
