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

/**
 * Log a message with a specific level and timestamp
 */
export function log(level: LogLevel, message: string) {
  const timestamp = new Date().toISOString();
  switch (level) {
    case LogLevel.INFO:
      console.log((chalk ? chalk.blue(`[${timestamp}] [INFO]`) : `[${timestamp}] [INFO]`) + ' ' + message);
      break;
    case LogLevel.WARN:
      console.warn((chalk ? chalk.yellow(`[${timestamp}] [WARN]`) : `[${timestamp}] [WARN]`) + ' ' + message);
      break;
    case LogLevel.ERROR:
      console.error((chalk ? chalk.red(`[${timestamp}] [ERROR]`) : `[${timestamp}] [ERROR]`) + ' ' + message);
      break;
    case LogLevel.DEBUG:
      console.debug((chalk ? chalk.gray(`[${timestamp}] [DEBUG]`) : `[${timestamp}] [DEBUG]`) + ' ' + message);
      break;
    case LogLevel.SUCCESS:
      console.log((chalk ? chalk.green(`[${timestamp}] [SUCCESS]`) : `[${timestamp}] [SUCCESS]`) + ' ' + message);
      break;
    default:
      console.log(`[${timestamp}] [LOG] ${message}`);
  }
}

/**
 * Shortcut functions
 */
export const info = (msg: string) => log(LogLevel.INFO, msg);
export const warn = (msg: string) => log(LogLevel.WARN, msg);
export const error = (msg: string) => log(LogLevel.ERROR, msg);
export const debug = (msg: string) => log(LogLevel.DEBUG, msg);
export const success = (msg: string) => log(LogLevel.SUCCESS, msg);
