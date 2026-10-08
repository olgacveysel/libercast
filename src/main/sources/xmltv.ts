import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import type { ParsedProgramme } from './types'
import { request, type FetchOptions } from '@main/util/http'

/**
 * XMLTV reader.
 *
 * Provider guide files routinely run to several hundred megabytes uncompressed,
 * so this streams: chunks are appended to a small buffer, complete
 * `<programme>` elements are cut out and emitted, and the remainder is carried
 * to the next chunk. Nothing holds the whole document, and a full DOM parser is
 * avoided entirely.
 */

const PROGRAMME_OPEN = '<programme'
const PROGRAMME_CLOSE = '</programme>'
const CHANNEL_OPEN = '<channel'
const CHANNEL_CLOSE = '</channel>'

/** `20260906123000 +0200`, `20260906123000` or `202609061230`. */
const XMLTV_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/

export function parseXmltvTime(value: string): number | null {
  const match = XMLTV_TIME.exec(value.trim())
  if (!match) return null

  const [, year, month, day, hour, minute, second, offset] = match
  const base = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? '0')
  )

  if (!offset) return base

  // The stamp is local to `offset`, so subtract it to reach UTC.
  const sign = offset.startsWith('-') ? -1 : 1
  const offsetMinutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5)))
  return base - offsetMinutes * 60_000
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag)
  return match ? match[1]! : null
}

function element(block: string, name: string): string | null {
  // Takes the first occurrence; XMLTV repeats these per language.
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block)
  return match ? decodeEntities(match[1]!).trim() || null : null
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'"
}

export function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity)
}

export function parseProgrammeBlock(block: string): ParsedProgramme | null {
  const tagEnd = block.indexOf('>')
  if (tagEnd === -1) return null

  const openTag = block.slice(0, tagEnd)
  const channelId = attribute(openTag, 'channel')
  const start = attribute(openTag, 'start')
  const stop = attribute(openTag, 'stop')
  if (!channelId || !start) return null

  const startsAt = parseXmltvTime(start)
  if (startsAt === null) return null

  // A missing stop is common on the last entry per channel; assume one hour
  // rather than dropping the programme.
  const endsAt = stop ? parseXmltvTime(stop) ?? startsAt + 3_600_000 : startsAt + 3_600_000
  if (endsAt <= startsAt) return null

  const body = block.slice(tagEnd + 1)
  const title = element(body, 'title')
  if (!title) return null

  return {
    channelId: decodeEntities(channelId),
    title,
    description: element(body, 'desc'),
    category: element(body, 'category'),
    startsAt,
    endsAt
  }
}

export interface XmltvChannel {
  id: string
  displayName: string
  iconUrl: string | null
}

/**
 * XMLTV declares its channels before the programmes, each with one or more
 * display names. Capturing them is what makes matching by name possible when
 * the provider's `tvg-id` values do not line up with the feed.
 */
export function parseChannelBlock(block: string): XmltvChannel | null {
  const tagEnd = block.indexOf('>')
  if (tagEnd === -1) return null

  const id = attribute(block.slice(0, tagEnd), 'id')
  if (!id) return null

  const body = block.slice(tagEnd + 1)
  const displayName = element(body, 'display-name')
  if (!displayName) return null

  const iconMatch = /<icon[^>]*src="([^"]*)"/i.exec(body)

  return {
    id: decodeEntities(id),
    displayName,
    iconUrl: iconMatch ? decodeEntities(iconMatch[1]!) : null
  }
}

export interface XmltvOptions extends FetchOptions {
  /** Minutes added to every timestamp, correcting provider timezone drift. */
  offsetMinutes?: number
  /** Programmes ending before this are dropped during parsing. */
  keepAfter?: number
  /** Programmes starting after this are dropped during parsing. */
  keepBefore?: number
  /** Called with each batch so the caller can write incrementally. */
  onBatch: (programmes: ParsedProgramme[]) => void
  /** Called once per channel declaration, before the programmes arrive. */
  onChannel?: (channel: XmltvChannel) => void
  onProgress?: (programmes: number) => void
}

const BATCH_SIZE = 2000

/** Feeds a text stream through the scanner. Exposed for tests. */
export async function scanXmltv(
  stream: AsyncIterable<string>,
  options: Pick<
    XmltvOptions,
    'offsetMinutes' | 'keepAfter' | 'keepBefore' | 'onBatch' | 'onChannel' | 'onProgress'
  >
): Promise<number> {
  const offsetMs = (options.offsetMinutes ?? 0) * 60_000
  let carry = ''
  let total = 0
  let batch: ParsedProgramme[] = []

  const flush = (): void => {
    if (batch.length === 0) return
    options.onBatch(batch)
    batch = []
  }

  for await (const chunk of stream) {
    carry += chunk

    // Channel declarations and programmes are interleaved in one pass. Taking
    // whichever element opens first keeps the buffer from being trimmed while
    // the other kind is still half-received — which is what silently dropped
    // every channel when the feed arrived in small chunks.
    for (;;) {
      const channelAt = options.onChannel ? carry.indexOf(CHANNEL_OPEN) : -1
      const programmeAt = carry.indexOf(PROGRAMME_OPEN)

      if (channelAt === -1 && programmeAt === -1) {
        // Nothing pending: keep only enough tail to catch a tag split across
        // this boundary and the next chunk.
        const tail = Math.max(PROGRAMME_OPEN.length, CHANNEL_OPEN.length) + 2
        carry = carry.slice(Math.max(0, carry.length - tail))
        break
      }

      const channelFirst =
        channelAt !== -1 && (programmeAt === -1 || channelAt < programmeAt)

      const openAt = channelFirst ? channelAt : programmeAt
      const openTag = channelFirst ? CHANNEL_OPEN : PROGRAMME_OPEN
      const closeTag = channelFirst ? CHANNEL_CLOSE : PROGRAMME_CLOSE

      const closeAt = carry.indexOf(closeTag, openAt)
      if (closeAt === -1) {
        // The element has started but not finished; wait for more input.
        carry = carry.slice(openAt)
        break
      }

      const block = carry.slice(openAt + openTag.length, closeAt)
      carry = carry.slice(closeAt + closeTag.length)

      if (channelFirst) {
        const channel = parseChannelBlock(block)
        if (channel) options.onChannel?.(channel)
        continue
      }

      const programme = parseProgrammeBlock(block)
      if (!programme) continue

      programme.startsAt += offsetMs
      programme.endsAt += offsetMs

      if (options.keepAfter != null && programme.endsAt < options.keepAfter) continue
      if (options.keepBefore != null && programme.startsAt > options.keepBefore) continue

      batch.push(programme)
      total++

      if (batch.length >= BATCH_SIZE) {
        flush()
        options.onProgress?.(total)
      }
    }
  }

  flush()
  return total
}

/** Downloads an XMLTV feed, transparently gunzipping it, and scans it. */
export async function loadXmltv(url: string, options: XmltvOptions): Promise<number> {
  const response = await request(url, { ...options, timeoutMs: options.timeoutMs ?? 300_000 })
  if (!response.body) throw new Error('EPG source returned an empty response')

  const raw = Readable.fromWeb(response.body as never) as unknown as AsyncIterable<Buffer>

  // Content-type and file extension both lie regularly here: xmltv.php usually
  // serves gzip with a text/html header. Sniff the magic bytes instead.
  const iterator = raw[Symbol.asyncIterator]()
  const first = await iterator.next()
  if (first.done) throw new Error('EPG source returned no data')

  const head = Buffer.from(first.value)
  const gzipped = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b

  async function* replay(): AsyncGenerator<Buffer> {
    yield head
    for (;;) {
      const next = await iterator.next()
      if (next.done) return
      yield Buffer.from(next.value)
    }
  }

  let stream: NodeJS.ReadableStream = Readable.from(replay())
  if (gzipped) stream = stream.pipe(createGunzip())
  stream.setEncoding('utf8')

  return scanXmltv(stream as unknown as AsyncIterable<string>, options)
}
