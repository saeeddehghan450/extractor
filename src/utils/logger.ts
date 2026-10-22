/**
 * logger.ts
 *
 * Professional colored CLI logging system
 */

let chalk: any = null;
try {
  chalk = require('chalk');
} catch (e) {
  chalk = null;
}

/**
 * Log levels
 */
export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
  SUCCESS = 'SUCCESS'
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
}

type LogListener = (entry: LogEntry) => void;
const listeners = new Set<LogListener>();

/** Subscribe to log entries (used by the dashboard). Returns an unsubscribe function. */
export function onLog(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const showDebug = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

const COLORS: Record<LogLevel, string> = {
  [LogLevel.INFO]: 'blue',
  [LogLevel.WARN]: 'yellow',
  [LogLevel.ERROR]: 'red',
  [LogLevel.DEBUG]: 'gray',
  [LogLevel.SUCCESS]: 'green'
};

/**
 * Log a message with a specific level and timestamp
 */
export function log(level: LogLevel, message: string) {
  const timestamp = new Date().toISOString();
  for (const l of listeners) {
    try { l({ timestamp, level, message }); } catch { /* ignore listener errors */ }
  }
  if (level === LogLevel.DEBUG && !showDebug) return;

  const prefix = `[${timestamp}] [${level}]`;
  const colored = chalk ? chalk[COLORS[level]](prefix) : prefix;
  const out = level === LogLevel.ERROR ? console.error : level === LogLevel.WARN ? console.warn : console.log;
  out(colored + ' ' + message);
}

/**
 * Shortcut functions
 */
export const info = (msg: string) => log(LogLevel.INFO, msg);
export const warn = (msg: string) => log(LogLevel.WARN, msg);
export const error = (msg: string) => log(LogLevel.ERROR, msg);
export const debug = (msg: string) => log(LogLevel.DEBUG, msg);
export const success = (msg: string) => log(LogLevel.SUCCESS, msg);
