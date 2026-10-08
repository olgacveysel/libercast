import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ParsedCatalog, ParsedChannel, ParsedCategory } from './types'
import { requestText, type FetchOptions } from '@main/util/http'

const EXTINF = /^#EXTINF:\s*(-?\d+)\s*(.*?),\s*(.*)$/
const ATTRIBUTE = /([a-zA-Z0-9-_]+)="([^"]*)"/g
const UNCATEGORIZED = '__uncategorized__'

interface Entry {
  attributes: Record<string, string>
  title: string
  url: string
  /** #EXTVLCOPT / #EXTGRP directives seen between EXTINF and the URL. */
  group?: string
}

/**
 * Parses an M3U playlist.
 *
 * Written as a single pass over lines rather than a regex over the whole file,
 * because provider playlists reach 40-80 MB and a global regex on a string that
 * size stalls the process for seconds.
 */
export function parseM3u(content: string): ParsedCatalog {
  const entries: Entry[] = []
  let pending: Entry | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue

    if (line.startsWith('#EXTINF:')) {
      const match = EXTINF.exec(line)
      if (!match) continue
      pending = {
        attributes: parseAttributes(match[2] ?? ''),
        title: (match[3] ?? '').trim(),
        url: ''
      }
      continue
    }

    if (line.startsWith('#EXTGRP:')) {
      if (pending) pending.group = line.slice('#EXTGRP:'.length).trim()
      continue
    }

    // Any other directive (#EXTVLCOPT, #EXTM3U, comments) is not needed here.
    if (line.startsWith('#')) continue

    if (pending) {
      pending.url = line
      entries.push(pending)
      pending = null
    }
  }

  return toCatalog(entries)
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  let match: RegExpExecArray | null
  ATTRIBUTE.lastIndex = 0
  while ((match = ATTRIBUTE.exec(source)) !== null) {
    attributes[match[1]!.toLowerCase()] = match[2] ?? ''
  }
  return attributes
}

function toCatalog(entries: Entry[]): ParsedCatalog {
  const categories = new Map<string, ParsedCategory>()
  const channels: ParsedChannel[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!entry.url) continue

    const groupName = entry.attributes['group-title'] || entry.group || ''
    const categoryId = groupName ? slug(groupName) : UNCATEGORIZED

    if (!categories.has(categoryId)) {
      categories.set(categoryId, { externalId: categoryId, name: groupName || 'Uncategorized' })
    }

    // M3U has no stable id, so derive one from the stream URL. Using the URL
    // means favorites survive a re-sync as long as the provider keeps the link.
    let externalId = hash(entry.url)
    if (seen.has(externalId)) externalId = hash(`${entry.url}|${entry.title}|${channels.length}`)
    seen.add(externalId)

    const number = entry.attributes['tvg-chno'] ?? entry.attributes['channel-number']

    channels.push({
      externalId,
      name: entry.attributes['tvg-name']?.trim() || entry.title || 'Unnamed',
      categoryExternalId: categoryId,
      number: number ? Number.parseInt(number, 10) || null : null,
      logoUrl: entry.attributes['tvg-logo'] || null,
      epgChannelId: entry.attributes['tvg-id'] || null,
      streamUrl: entry.url,
      containerExtension: extensionOf(entry.url),
      isAdult: looksAdult(groupName) || looksAdult(entry.title)
    })
  }

  return {
    kind: 'live',
    categories: [...categories.values()].sort((a, b) => a.name.localeCompare(b.name)),
    channels
  }
}

export async function loadM3u(
  source: { url?: string; filePath?: string | null },
  options: FetchOptions = {}
): Promise<ParsedCatalog> {
  if (source.filePath) {
    return parseM3u(await readFile(source.filePath, 'utf8'))
  }
  if (!source.url) throw new Error('M3U source needs either a URL or a file path')
  return parseM3u(await requestText(source.url, { ...options, timeoutMs: 120_000 }))
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || UNCATEGORIZED
}

function hash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}

function extensionOf(url: string): string | null {
  const match = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url)
  return match ? match[1]!.toLowerCase() : null
}

const ADULT_PATTERN = /\b(xxx|adult|porn|18\+|erotic)\b/i

function looksAdult(value: string): boolean {
  return ADULT_PATTERN.test(value)
}
