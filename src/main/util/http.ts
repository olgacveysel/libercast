import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface FetchOptions {
  userAgent?: string | null
  referrer?: string | null
  timeoutMs?: number
  signal?: AbortSignal
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export function buildHeaders(options: FetchOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': options.userAgent || DEFAULT_UA,
    Accept: '*/*'
  }
  if (options.referrer) headers['Referer'] = options.referrer
  return headers
}

/**
 * fetch with a hard timeout. IPTV providers routinely accept a connection and
 * then never respond; without this the sync hangs forever.
 */
export async function request(url: string, options: FetchOptions = {}): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000)

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const response = await fetch(url, { headers: buildHeaders(options), signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${redact(url)}`)
    }
    return response
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Request timed out: ${redact(url)}`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function requestJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await request(url, options)
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    // Xtream panels often answer with an HTML error page and a 200 status.
    throw new Error(`Expected JSON but got ${text.slice(0, 120)}`)
  }
}

export async function requestText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await request(url, options)
  return response.text()
}

export async function downloadTo(url: string, destination: string, options: FetchOptions = {}): Promise<void> {
  const response = await request(url, options)
  if (!response.body) throw new Error('Response has no body')
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination))
}

/** Strips credentials so URLs are safe to put in logs and error messages. */
export function redact(url: string): string {
  // Global, not first-match: a log line can carry more than one URL — a
  // redirect chain, or an error naming both the URL it tried and the one it
  // fell back to — and these lines are written to a file that gets attached to
  // bug reports.
  return (
    url
      .replace(/(username=)[^&\s]*/gi, '$1***')
      .replace(/(password=)[^&\s]*/gi, '$1***')
      .replace(/\/\/[^/@\s]+:[^/@\s]+@/g, '//***:***@')
      // Xtream Codes puts the credentials in the path, not the query — a live
      // URL is /live/<username>/<password>/<id>.ts — so this is the shape that
      // actually turns up in this application's logs, and the query-string
      // rules above do nothing about it.
      .replace(/\/(live|movie|series)\/[^/\s]+\/[^/\s]+\//gi, '/$1/***/***/')
      // The same panels also serve the playlist and the guide as
      // /get.php?username=…, and timeshift as /timeshift/<user>/<pass>/…
      .replace(/\/timeshift\/[^/\s]+\/[^/\s]+\//gi, '/timeshift/***/***/')
  )
}
