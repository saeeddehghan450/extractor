/**
 * fileUtils.ts
 *
 * Helper functions for saving files, creating directories, and sanitizing file names
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Ensure a directory exists
 */
export function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Generate a safe, readable file name for a URL: <prefix>-<last path segment>-<hash>.<ext>
 */
export function makeSafeFileName(prefix: string, urlOrName: string, ext: string = 'txt'): string {
  const hash = crypto.createHash('sha1').update(urlOrName).digest('hex').slice(0, 10);
  let base = '';
  try {
    const u = new URL(urlOrName);
    base = path.basename(u.pathname).replace(/\.[a-z0-9]+$/i, '');
  } catch {
    base = urlOrName;
  }
  base = base.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  return `${prefix}${base ? '-' + base : ''}-${hash}.${ext}`;
}

/**
 * Save a large body to a file and return the file path
 */
export function saveBodyToFile(dir: string, prefix: string, url: string, body: string | Buffer, ext = 'txt'): string {
  ensureDir(dir);
  const filePath = path.join(dir, makeSafeFileName(prefix, url + ':' + Date.now(), ext));
  fs.writeFileSync(filePath, body);
  return filePath;
}

/**
 * Save JSON data to a file
 */
export function writeJSON(filePath: string, data: unknown): string {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

export function readJSON<T = any>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/**
 * Save source file content (JS/CSS) into the sources folder
 */
export function saveSourceFile(dir: string, url: string, content: string, ext: string = 'js'): string {
  ensureDir(dir);
  const filePath = path.join(dir, makeSafeFileName('source', url, ext));
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/** Path relative to `root`, always with forward slashes. */
export function relPath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}
