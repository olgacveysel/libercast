import { redact } from './http'
import { appendLogLine } from './logfile'

type Level = 'debug' | 'info' | 'warn' | 'error'

const ENABLED: Level[] = process.env.NODE_ENV === 'development'
  ? ['debug', 'info', 'warn', 'error']
  : ['info', 'warn', 'error']

function write(level: Level, scope: string, message: string, detail?: unknown): void {
  if (!ENABLED.includes(level)) return
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${redact(message)}`
  if (level === 'error') console.error(line, detail ?? '')
  else if (level === 'warn') console.warn(line, detail ?? '')
  else console.log(line, detail ?? '')

  // The same line goes to a file, because a packaged application has no console
  // and a tester has to be able to send the log. The detail is redacted too:
  // it is often an error carrying the URL that failed, and that URL carries the
  // provider's username and password.
  appendLogLine(detail === undefined ? line : `${line} ${redact(describe(detail))}`)
}

/**
 * Renders a detail value for the file.
 *
 * Errors print as "{}" through JSON.stringify, which is exactly the case that
 * matters most in a bug report, so they are handled first.
 */
function describe(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? `${detail.name}: ${detail.message}`
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail) ?? String(detail)
  } catch {
    // Circular, or something with a throwing getter.
    return String(detail)
  }
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, detail?: unknown) => write('debug', scope, message, detail),
    info: (message: string, detail?: unknown) => write('info', scope, message, detail),
    warn: (message: string, detail?: unknown) => write('warn', scope, message, detail),
    error: (message: string, detail?: unknown) => write('error', scope, message, detail)
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
