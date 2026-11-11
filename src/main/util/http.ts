import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface FetchOptions {
  userAgent?: string | null
  referrer?: string | null
  timeoutMs?: number
  signal?: AbortSignal
  /**
   * Extra headers, merged over the defaults.
   *
   * A Stalker portal authenticates with a `Cookie` carrying the MAC address
   * and an `Authorization` bearer token, neither of which any other source
   * needs — so they are passed in rather than built into the defaults.
   */
  headers?: Record<string, string>
  /** Defaults to GET. */
  method?: 'GET' | 'POST'
  /** Sent as the request body; the caller sets its Content-Type. */
  body?: string
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export function buildHeaders(options: FetchOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': options.userAgent || DEFAULT_UA,
    Accept: '*/*'
  }
  if (options.referrer) headers['Referer'] = options.referrer
  return { ...headers, ...(options.headers ?? {}) }
}

/**
 * The same timeout, without the throw on a non-2xx.
 *
 * Most callers here want an error for anything but success, which is what
 * `request` gives them. An API that distinguishes its failures in the
 * *response* — a 401 meaning a bad key or a bad login, a 429 carrying how
 * long to wait — needs to read the body and the headers of a failed reply,
 * and `request` has thrown them away by then.
 */
export async function requestRaw(url: string, options: FetchOptions = {}): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000)

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers: buildHeaders(options),
      body: options.body,
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Request timed out: ${redact(url)}`, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * fetch with a hard timeout. IPTV providers routinely accept a connection and
 * then never respond; without this the sync hangs forever.
 */
export async function request(url: string, options: FetchOptions = {}): Promise<Response> {
  const response = await requestRaw(url, options)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${redact(url)}`)
  }
  return response
}

/**
 * Puts a deadline on reading a body, not just on getting the headers.
 *
 * The timeout above is cleared the moment `fetch` resolves, which is when the
 * *headers* arrive. A provider that answers 200 and then dribbles — or stops
 * — leaves the read hanging with nothing to interrupt it, and a sync that
 * waits forever is indistinguishable from one that crashed.
 *
 * So anything that consumes a body races it against a clock of its own.
 */
async function withBodyDeadline<T>(url: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Response body stalled: ${redact(url)}`)), ms)
  })

  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

export async function requestJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await request(url, options)
  const text = await withBodyDeadline(url, options.timeoutMs ?? 30_000, response.text())
  try {
    return JSON.parse(text) as T
  } catch {
    // Xtream panels often answer with an HTML error page and a 200 status.
    throw new Error(`Expected JSON but got ${text.slice(0, 120)}`)
  }
}

export async function requestText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await request(url, options)
  return withBodyDeadline(url, options.timeoutMs ?? 30_000, response.text())
}

export async function downloadTo(url: string, destination: string, options: FetchOptions = {}): Promise<void> {
  const response = await request(url, options)
  if (!response.body) throw new Error('Response has no body')

  // A download is allowed to take far longer than a request, but not forever:
  // a provider that stops sending partway leaves the pipeline waiting with
  // nothing to interrupt it.
  await withBodyDeadline(
    url,
    options.timeoutMs ?? 10 * 60_000,
    pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination))
  )
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
      // On a Stalker portal the MAC address *is* the credential: it is the
      // whole of the authentication, it is what the provider sells, and it
      // arrives in a cookie, in a query string and in the play URL the portal
      // hands back. Anyone holding it holds the subscription.
      //
      // Matched as a bare address anywhere in the line rather than only after
      // `mac=`, because it also turns up in the cookie header and in error
      // text quoting a request. The separator may be a colon, a dash or the
      // URL-encoded `%3A` the portal's own cookie uses.
      .replace(/\b(?:[0-9a-f]{2}(?::|-|%3a)){5}[0-9a-f]{2}\b/gi, '**:**:**:**:**:**')
      /*
       * Play tokens and their relatives.
       *
       * A portal's `create_link` hands back a URL carrying a `play_token`,
       * and that URL is logged on every open — ninety times in one real
       * session's log. The token is short-lived and often single-use, so it
       * is not a password; but the release notes tell users the log is safe
       * to attach to an issue, and a log containing live tokens is not quite
       * what that promises.
       *
       * Named parameters rather than anything that looks random: an id, a
       * channel number or a timestamp can look random too, and redacting
       * those would take away exactly what a log is read for.
       */
      .replace(
        /\b(play_token|token|access_token|auth|auth_token|session|sig|signature|key)=[^&\s"']*/gi,
        '$1=***'
      )
  )
}
