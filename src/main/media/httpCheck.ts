/**
 * Finding out what a provider URL *actually* returns.
 *
 * ffmpeg's failure messages describe the bytes it received, not the reason it
 * received them: a provider that answers a series request with an HTML error
 * page produces "EBML header parsing failed", and a wrong container extension
 * produces "Invalid data found when processing input". Both are unactionable.
 *
 * This module asks for the first few kilobytes over plain HTTP and reports what
 * came back — the status, the redirect chain, and whether the bytes are a media
 * container at all — so the player can say "the provider returned an error page"
 * or quietly try a different extension instead of transcoding nothing.
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { URL } from 'node:url'
import { DEFAULT_USER_AGENT } from './args'

export interface StreamCheck {
  /** The bytes look like something ffmpeg can open. */
  ok: boolean
  status: number | null
  contentType: string | null
  /** Set when a redirect was followed, so the caller can log where it went. */
  finalUrl: string | null
  /** Container guessed from the first bytes: 'matroska', 'mp4', 'mpegts', … */
  container: string | null
  /** Human-readable explanation when `ok` is false. */
  reason: string | null
  /**
   * True when the provider gave a clear answer — an error status, or a web page
   * where video should be. A refusal that is only *probably* a failure (no data,
   * a socket that would not open) is not definitive: providers do that when
   * they are busy, and ffmpeg often succeeds moments later on the same URL.
   *
   * Only a definitive failure justifies spending more provider connections
   * hunting for a different container extension.
   */
  definitive: boolean
}

const MAX_REDIRECTS = 5
const SNIFF_BYTES = 8192
const TIMEOUT_MS = 12_000

/**
 * Content types a provider legitimately uses for a stream. Panels are careless
 * here — `application/octet-stream` and even `text/plain` are common — so the
 * type alone never decides; it only breaks ties when the bytes are ambiguous.
 */
const MEDIA_CONTENT_TYPES = /^(video|audio)\/|octet-stream|mpegurl|mp2t|dash\+xml/i

/**
 * Identifies a container from its first bytes.
 *
 * This is the reliable signal. A provider can lie in every header it sends, but
 * the first four bytes of a Matroska file are always 1A 45 DF A3.
 */
export function sniffContainer(head: Buffer): string | null {
  if (head.length < 4) return null

  // EBML: Matroska and WebM.
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'matroska'

  // ISO base media: a size field then 'ftyp'. Some files lead with 'styp'/'moov'.
  const boxType = head.subarray(4, 8).toString('latin1')
  if (boxType === 'ftyp' || boxType === 'styp' || boxType === 'moov' || boxType === 'skip') return 'mp4'

  // MPEG-TS: 0x47 sync bytes 188 apart. One is a coincidence, three are not.
  if (head[0] === 0x47 && head[188] === 0x47 && head[376] === 0x47) return 'mpegts'

  const text = head.subarray(0, 16).toString('latin1')
  if (text.startsWith('#EXTM3U')) return 'hls'
  if (text.startsWith('FLV')) return 'flv'
  if (text.startsWith('OggS')) return 'ogg'
  if (text.startsWith('RIFF')) return 'avi'
  // ASF / WMV.
  if (head[0] === 0x30 && head[1] === 0x26 && head[2] === 0xb2 && head[3] === 0x75) return 'asf'
  // ID3-tagged or raw MPEG audio.
  if (text.startsWith('ID3')) return 'mp3'
  if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return 'adts'

  return null
}

/** True when the body is obviously a web page or an API error, not a stream. */
function looksLikeText(head: Buffer): boolean {
  const start = head.subarray(0, 512).toString('utf8').trimStart().toLowerCase()
  return (
    start.startsWith('<!doctype') ||
    start.startsWith('<html') ||
    start.startsWith('<?xml') ||
    start.startsWith('{') ||
    start.startsWith('[')
  )
}

/**
 * Pulls something quotable out of an error page, so the user sees the
 * provider's own words rather than a generic failure.
 */
export function describeBody(head: Buffer): string | null {
  const text = head.subarray(0, 2048).toString('utf8')

  // Strip tags and collapse whitespace; a panel's message is usually short.
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (stripped.length === 0) return null
  return stripped.length > 160 ? `${stripped.slice(0, 157)}…` : stripped
}

export interface CheckOptions {
  userAgent?: string | null
  referrer?: string | null
}

/**
 * Fetches the first few kilobytes and classifies them.
 *
 * Never throws: a network failure is itself a result the caller wants to show.
 */
export async function inspectStream(url: string, options: CheckOptions = {}): Promise<StreamCheck> {
  const empty: StreamCheck = {
    ok: false,
    status: null,
    contentType: null,
    finalUrl: null,
    container: null,
    reason: null,
    definitive: false
  }

  let current = url
  const seen: string[] = []

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: HeadAndBody
    try {
      response = await fetchHead(current, options)
    } catch (error) {
      return {
        ...empty,
        finalUrl: hop > 0 ? current : null,
        reason: `Could not reach the provider: ${(error as Error).message}`
      }
    }

    // 3xx with a Location: follow it ourselves so the hop count is reportable.
    if (response.status >= 300 && response.status < 400 && response.location) {
      seen.push(current)
      try {
        current = new URL(response.location, current).toString()
      } catch {
        return {
          ...empty,
          status: response.status,
          reason: 'The provider sent an invalid redirect.',
          definitive: true
        }
      }
      continue
    }

    const finalUrl = seen.length > 0 ? current : null
    const contentType = response.contentType

    if (response.status >= 400) {
      return {
        ok: false,
        status: response.status,
        contentType,
        finalUrl,
        container: null,
        reason: explainStatus(response.status, response.body),
        definitive: true
      }
    }

    const container = sniffContainer(response.body)
    if (container) {
      return {
        ok: true,
        status: response.status,
        contentType,
        finalUrl,
        container,
        reason: null,
        definitive: true
      }
    }

    if (response.body.length === 0) {
      return {
        ok: false,
        status: response.status,
        contentType,
        finalUrl,
        container: null,
        reason:
          'The provider accepted the request but sent no data. That usually means its ' +
          'connection limit is reached — close anything else that is playing and try again.',
        // Not definitive: a busy panel answers this way for a stream that is
        // perfectly fine a second later, so this must never be the last word.
        definitive: false
      }
    }

    if (looksLikeText(response.body)) {
      const detail = describeBody(response.body)
      return {
        ok: false,
        status: response.status,
        contentType,
        finalUrl,
        container: null,
        reason: detail
          ? `The provider returned a page instead of video: “${detail}”`
          : 'The provider returned a web page instead of video.',
        definitive: true
      }
    }

    // Unrecognised bytes with a plausible content type: let ffmpeg decide.
    if (contentType && MEDIA_CONTENT_TYPES.test(contentType)) {
      return {
        ok: true,
        status: response.status,
        contentType,
        finalUrl,
        container: null,
        reason: null,
        definitive: false
      }
    }

    return {
      ok: false,
      status: response.status,
      contentType,
      finalUrl,
      container: null,
      reason: `The provider sent something that is not a video stream${
        contentType ? ` (${contentType})` : ''
      }.`,
      definitive: true
    }
  }

  return { ...empty, reason: 'The provider redirected too many times.', definitive: true }
}

function explainStatus(status: number, body: Buffer): string {
  const detail = describeBody(body)
  const suffix = detail ? ` — “${detail}”` : ''

  if (status === 401 || status === 403) {
    return `The provider rejected the credentials for this item (HTTP ${status}).${suffix} The account may not include it, or may have expired.`
  }
  if (status === 404) {
    return `The provider does not have this item at that address (HTTP 404).${suffix} Re-syncing the source usually fixes it.`
  }
  if (status === 429 || status === 509) {
    return `The provider is refusing more connections right now (HTTP ${status}).${suffix}`
  }
  if (status >= 500) {
    return `The provider's server failed (HTTP ${status}).${suffix}`
  }
  return `The provider answered HTTP ${status}.${suffix}`
}

interface HeadAndBody {
  status: number
  contentType: string | null
  location: string | null
  body: Buffer
}

/**
 * A plain GET that is abandoned after the first few kilobytes.
 *
 * Not a HEAD: panels routinely answer HEAD with 405, or with headers that do
 * not match what a GET would return. Not a ranged GET either — a panel that
 * does not implement Range answers 200 with an empty body, which is
 * indistinguishable from a connection limit and had this reporting a limit for
 * streams that played fine.
 */
function fetchHead(url: string, options: CheckOptions): Promise<HeadAndBody> {
  return new Promise((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error('not a valid URL'))
      return
    }

    const secure = parsed.protocol === 'https:'
    const send = secure ? httpsRequest : httpRequest

    const requestOptions: RequestOptions = {
      method: 'GET',
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        Accept: '*/*',
        // The socket is dropped as soon as there are enough bytes to identify
        // the container, so the provider's connection is held for a moment
        // rather than for the length of the file.
        Connection: 'close',
        ...(options.referrer ? { Referer: options.referrer } : {})
      }
    }

    const req = send(parsed, requestOptions, (res) => {
      const chunks: Buffer[] = []
      let received = 0

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        received += chunk.length
        // Enough to identify it. Reading further would hold a provider
        // connection open for no reason.
        if (received >= SNIFF_BYTES) {
          res.destroy()
          finish()
        }
      })

      res.on('end', finish)
      res.on('error', finish)

      let done = false
      function finish(): void {
        if (done) return
        done = true
        resolve({
          status: res.statusCode ?? 0,
          contentType: (res.headers['content-type'] as string | undefined) ?? null,
          location: (res.headers.location as string | undefined) ?? null,
          body: Buffer.concat(chunks)
        })
      }
    })

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error('timed out'))
    })

    req.on('error', reject)
    req.end()
  })
}

/** The extension a sniffed container implies, for retrying a VOD URL. */
export function extensionFor(container: string): string | null {
  switch (container) {
    case 'matroska':
      return 'mkv'
    case 'mp4':
      return 'mp4'
    case 'mpegts':
      return 'ts'
    case 'avi':
      return 'avi'
    case 'asf':
      return 'wmv'
    default:
      return null
  }
}
