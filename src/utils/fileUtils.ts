/**
 * fileUtils.ts
 * 
 * Helper functions for saving files, creating directories, and sanitizing file names
 */

import fs from 'fs';
import path from 'path';

/**
 * Ensure a directory exists
 */
export function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Generate a safe file name with date and base64 from URL
 */
export function makeSafeFileName(prefix: string, urlOrName: string, ext: string = 'txt'): string {
  const safePart = Buffer.from(urlOrName).toString('base64').slice(0, 32);
  const fileName = `${prefix}-${Date.now()}-${safePart}.${ext}`;
  return fileName.replace(/[/\\?%*:|"<>]/g, '_'); // sanitize
}

/**
 * Save a large body to a file and return the file path
 */
export function saveBodyToFile(dir: string, prefix: string, url: string, body: string): string {
  ensureDir(dir);
  const fileName = makeSafeFileName(prefix, url);
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, body, 'utf-8');
  return filePath;
}

/**
 * Save JSON data to a file
 */
export function saveJSONToFile(dir: string, prefix: string, data: any): string {
  ensureDir(dir);
  const fileName = `${prefix}-${Date.now()}.json`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

/**
 * Save source file content (JS/CSS) into the sources folder
 */
export function saveSourceFile(dir: string, url: string, content: string, ext: string = 'js'): string {
  ensureDir(dir);
  const fileName = makeSafeFileName('source', url, ext);
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}
