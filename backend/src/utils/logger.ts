// backend/src/utils/logger.ts
// Simple, reliable logging utility

import fs from 'fs';
import path from 'path';

const LOG_DIR = process.env.LOG_DIR || './logs';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Log levels with priority
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

type LogLevel = keyof typeof levels;

interface LogMetadata {
  [key: string]: any;
}

class Logger {
  private minLevel: number;

  constructor() {
    this.minLevel = levels[LOG_LEVEL as LogLevel] ?? levels.info;
  }

  private shouldLog(level: LogLevel): boolean {
    return levels[level] <= this.minLevel;
  }

  private formatMessage(level: LogLevel, message: string, meta?: LogMetadata): string {
    const timestamp = new Date().toISOString();
    const metaString = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaString}`;
  }

  private writeToFile(level: LogLevel, message: string, meta?: LogMetadata): void {
    if (NODE_ENV === 'production' || NODE_ENV === 'staging') {
      const logFile = path.join(LOG_DIR, `${level}.log`);
      const formattedMessage = this.formatMessage(level, message, meta);
      
      fs.appendFile(logFile, formattedMessage + '\n', (err) => {
        if (err) console.error('Failed to write to log file:', err);
      });
    }
  }

  private log(level: LogLevel, message: string, meta?: LogMetadata): void {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, message, meta);

    // Console output with colors
    switch (level) {
      case 'error':
        console.error('\x1b[31m%s\x1b[0m', formattedMessage); // Red
        break;
      case 'warn':
        console.warn('\x1b[33m%s\x1b[0m', formattedMessage); // Yellow
        break;
      case 'info':
        console.info('\x1b[36m%s\x1b[0m', formattedMessage); // Cyan
        break;
      case 'http':
        console.log('\x1b[35m%s\x1b[0m', formattedMessage); // Magenta
        break;
      case 'debug':
        console.log('\x1b[37m%s\x1b[0m', formattedMessage); // White
        break;
      default:
        console.log(formattedMessage);
    }

    // Write to file
    this.writeToFile(level, message, meta);
  }

  error(message: string, meta?: LogMetadata): void {
    this.log('error', message, meta);
  }

  warn(message: string, meta?: LogMetadata): void {
    this.log('warn', message, meta);
  }

  info(message: string, meta?: LogMetadata): void {
    this.log('info', message, meta);
  }

  http(message: string, meta?: LogMetadata): void {
    this.log('http', message, meta);
  }

  debug(message: string, meta?: LogMetadata): void {
    this.log('debug', message, meta);
  }

  // Create child logger with context
  child(context: string): Logger {
    const childLogger = new Logger();
    
    // Override log methods to include context
    const originalLog = childLogger.log.bind(childLogger);
    childLogger.log = (level: LogLevel, message: string, meta?: LogMetadata) => {
      originalLog(level, `[${context}] ${message}`, meta);
    };

    return childLogger;
  }
}

// Export singleton instance
const logger = new Logger();

export { logger, Logger };
export default logger;