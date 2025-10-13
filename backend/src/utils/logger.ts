// backend/src/utils/logger.ts
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Log levels
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  HTTP = 3,
  DEBUG = 4
}

// Log level names
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.HTTP]: 'HTTP',
  [LogLevel.DEBUG]: 'DEBUG'
}

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
}

// Log level colors
const LOG_COLORS: Record<LogLevel, string> = {
  [LogLevel.ERROR]: COLORS.red,
  [LogLevel.WARN]: COLORS.yellow,
  [LogLevel.INFO]: COLORS.blue,
  [LogLevel.HTTP]: COLORS.green,
  [LogLevel.DEBUG]: COLORS.gray
}

interface LogEntry {
  timestamp: string
  level: string
  message: string
  metadata?: any
  context?: string
}

class Logger {
  private currentLevel: LogLevel
  private fileStream?: ReturnType<typeof createWriteStream>
  private enableConsole: boolean
  private enableFile: boolean

  constructor() {
    // Set log level from environment or default to INFO
    const envLevel = process.env.LOG_LEVEL?.toUpperCase()
    this.currentLevel = this.parseLogLevel(envLevel) ?? LogLevel.INFO

    // Enable/disable outputs
    this.enableConsole = process.env.LOG_CONSOLE !== 'false'
    this.enableFile = process.env.LOG_FILE === 'true'

    // Initialize file logging if enabled
    if (this.enableFile) {
      this.initFileLogging()
    }
  }

  private parseLogLevel(level?: string): LogLevel | null {
    if (!level) return null
    
    const mapping: Record<string, LogLevel> = {
      ERROR: LogLevel.ERROR,
      WARN: LogLevel.WARN,
      INFO: LogLevel.INFO,
      HTTP: LogLevel.HTTP,
      DEBUG: LogLevel.DEBUG
    }
    
    return mapping[level] ?? null
  }

  private initFileLogging(): void {
    try {
      const logsDir = join(process.cwd(), 'logs')
      
      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true })
      }

      const logFile = join(logsDir, `app-${new Date().toISOString().split('T')[0]}.log`)
      this.fileStream = createWriteStream(logFile, { flags: 'a' })

      this.fileStream.on('error', (err) => {
        console.error('File logging error:', err)
        this.enableFile = false
      })
    } catch (error) {
      console.error('Failed to initialize file logging:', error)
      this.enableFile = false
    }
  }

  private formatTimestamp(): string {
    return new Date().toISOString()
  }

  private formatMessage(level: LogLevel, message: string, metadata?: any): string {
    const timestamp = this.formatTimestamp()
    const levelName = LOG_LEVEL_NAMES[level]
    
    let formatted = `${timestamp} [${levelName}] ${message}`
    
    if (metadata) {
      formatted += ` ${JSON.stringify(metadata)}`
    }
    
    return formatted
  }

  private formatConsoleMessage(level: LogLevel, message: string, metadata?: any, context?: string): string {
    const timestamp = this.formatTimestamp()
    const levelName = LOG_LEVEL_NAMES[level]
    const color = LOG_COLORS[level]
    
    let formatted = `${COLORS.gray}${timestamp}${COLORS.reset} ${color}[${levelName}]${COLORS.reset}`
    
    if (context) {
      formatted += ` ${COLORS.cyan}[${context}]${COLORS.reset}`
    }
    
    formatted += ` ${message}`
    
    if (metadata) {
      if (metadata instanceof Error) {
        formatted += `\n${COLORS.red}${metadata.stack}${COLORS.reset}`
      } else {
        formatted += `\n${COLORS.gray}${JSON.stringify(metadata, null, 2)}${COLORS.reset}`
      }
    }
    
    return formatted
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel
  }

  private writeLog(level: LogLevel, message: string, metadata?: any, context?: string): void {
    if (!this.shouldLog(level)) return

    // Console output
    if (this.enableConsole) {
      const consoleMsg = this.formatConsoleMessage(level, message, metadata, context)
      console.log(consoleMsg)
    }

    // File output
    if (this.enableFile && this.fileStream) {
      const fileMsg = this.formatMessage(level, message, metadata)
      this.fileStream.write(fileMsg + '\n')
    }
  }

  error(message: string, metadata?: any, context?: string): void {
    this.writeLog(LogLevel.ERROR, message, metadata, context)
  }

  warn(message: string, metadata?: any, context?: string): void {
    this.writeLog(LogLevel.WARN, message, metadata, context)
  }

  info(message: string, metadata?: any, context?: string): void {
    this.writeLog(LogLevel.INFO, message, metadata, context)
  }

  http(message: string, metadata?: any, context?: string): void {
    this.writeLog(LogLevel.HTTP, message, metadata, context)
  }

  debug(message: string, metadata?: any, context?: string): void {
    this.writeLog(LogLevel.DEBUG, message, metadata, context)
  }

  // Convenience methods for common use cases
  
  logRequest(req: any): void {
    this.http(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      query: req.query,
      body: this.sanitizeBody(req.body)
    }, 'REQUEST')
  }

  logResponse(req: any, res: any, duration: number): void {
    const level = res.statusCode >= 500 ? LogLevel.ERROR :
                  res.statusCode >= 400 ? LogLevel.WARN :
                  LogLevel.HTTP

    this.writeLog(level, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
      statusCode: res.statusCode,
      duration
    }, 'RESPONSE')
  }

  logDatabaseQuery(query: string, duration: number, error?: Error): void {
    if (error) {
      this.error('Database query failed', {
        query: query.substring(0, 200),
        duration,
        error: error.message
      }, 'DATABASE')
    } else if (duration > 1000) {
      this.warn('Slow database query', {
        query: query.substring(0, 200),
        duration
      }, 'DATABASE')
    } else {
      this.debug('Database query', {
        query: query.substring(0, 100),
        duration
      }, 'DATABASE')
    }
  }

  logStripeEvent(eventType: string, metadata?: any): void {
    this.info(`Stripe event: ${eventType}`, metadata, 'STRIPE')
  }

  logFileProcessing(filename: string, status: string, metadata?: any): void {
    this.info(`File processing: ${filename} - ${status}`, metadata, 'FILE_PROCESSOR')
  }

  logAuth(action: string, email: string, success: boolean, metadata?: any): void {
    const level = success ? LogLevel.INFO : LogLevel.WARN
    this.writeLog(level, `Auth ${action}: ${email} - ${success ? 'success' : 'failed'}`, metadata, 'AUTH')
  }

  private sanitizeBody(body: any): any {
    if (!body) return body
    
    const sanitized = { ...body }
    const sensitiveFields = ['password', 'password_hash', 'token', 'secret', 'api_key', 'apiKey']
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]'
      }
    }
    
    return sanitized
  }

  // Create child logger with context
  child(context: string): ChildLogger {
    return new ChildLogger(this, context)
  }

  // Flush and close file stream
  close(): void {
    if (this.fileStream) {
      this.fileStream.end()
    }
  }
}

// Child logger with preset context
class ChildLogger {
  constructor(private parent: Logger, private context: string) {}

  error(message: string, metadata?: any): void {
    this.parent.error(message, metadata, this.context)
  }

  warn(message: string, metadata?: any): void {
    this.parent.warn(message, metadata, this.context)
  }

  info(message: string, metadata?: any): void {
    this.parent.info(message, metadata, this.context)
  }

  http(message: string, metadata?: any): void {
    this.parent.http(message, metadata, this.context)
  }

  debug(message: string, metadata?: any): void {
    this.parent.debug(message, metadata, this.context)
  }
}

// Singleton instance
const logger = new Logger()

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.close()
})

process.on('SIGINT', () => {
  logger.close()
})

export default logger
export { Logger, ChildLogger }