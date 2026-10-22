/**
 * sessionStore.ts
 *
 * Read-only access to saved sessions in the output folder.
 */

import fs from 'fs';
import path from 'path';
import { readJSON } from '../utils/fileUtils';
import type { SessionSummary } from './session';

export const OUTPUT_DIR = path.resolve(process.cwd(), process.env.EXTRACTOR_OUTPUT || 'output');

const ID_RE = /^[a-zA-Z0-9._-]+$/;

export function isValidSessionId(id: string): boolean {
  return ID_RE.test(id) && id !== '.' && id !== '..';
}

export function sessionDir(id: string): string {
  if (!isValidSessionId(id)) throw new Error('Invalid session id');
  return path.join(OUTPUT_DIR, id);
}

export function listSessions(): SessionSummary[] {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  const out: SessionSummary[] = [];
  for (const name of fs.readdirSync(OUTPUT_DIR)) {
    if (!isValidSessionId(name)) continue;
    const manifest = readJSON<SessionSummary>(path.join(OUTPUT_DIR, name, 'session.json'));
    if (manifest) out.push(manifest);
  }
  return out.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

export function getSession(id: string): SessionSummary | null {
  return readJSON<SessionSummary>(path.join(sessionDir(id), 'session.json'));
}

export function deleteSession(id: string): boolean {
  const dir = sessionDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Resolve a file inside a session folder, refusing anything that escapes it.
 */
export function resolveSessionFile(id: string, relative: string): string | null {
  const root = sessionDir(id);
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

export interface FileEntry {
  path: string;
  size: number;
}

/** All files of a session (relative paths), for the file browser of the dashboard. */
export function listSessionFiles(id: string): FileEntry[] {
  const root = sessionDir(id);
  const out: FileEntry[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push({ path: path.relative(root, full).split(path.sep).join('/'), size: fs.statSync(full).size });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
