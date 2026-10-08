import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { ExternalSubtitle } from '@shared/types'
import { binaries } from './binaries'
import { createLogger, errorMessage } from '@main/util/logger'

const log = createLogger('subtitles')

/** Formats the built-in converter handles without help from ffmpeg. */
const NATIVE = new Set(['.srt', '.vtt'])

/** Anything else goes through ffmpeg, which knows ASS/SSA styling and the rest. */
export const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass', 'ssa', 'sub', 'smi', 'ssf', 'txt']

/**
 * Subtitle files are very often not UTF-8.
 *
 * Turkish subtitles are usually Windows-1254, Western European ones
 * Windows-1252, and both decode as mojibake if read as UTF-8. Encoding is not
 * declared anywhere in the file, so it has to be inferred: valid UTF-8 is taken
 * at its word, and anything else is decoded with the legacy code page whose
 * character set best explains the bytes.
 */
export function decodeSubtitleBytes(bytes: Buffer): { text: string; encoding: string } {
  // A BOM settles it outright.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf-8' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }

  try {
    // `fatal` makes the decoder reject byte sequences that are not valid UTF-8,
    // which is exactly the signal that this is a legacy code page.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, encoding: 'utf-8' }
  } catch {
    // Not UTF-8. Windows-1254 is a superset of 1252 apart from six Turkish
    // letters, so decoding with it recovers Turkish files and leaves Western
    // European ones unchanged.
    return { text: new TextDecoder('windows-1254').decode(bytes), encoding: 'windows-1254' }
  }
}

/** `00:01:02,500` in SubRip becomes `00:01:02.500` in WebVTT. */
function srtTimeToVtt(value: string): string {
  return value.trim().replace(',', '.')
}

const SRT_TIMING = /^(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})(.*)$/

/**
 * Converts SubRip to WebVTT.
 *
 * The two formats differ in three ways that matter: the header, comma decimal
 * separators, and the numeric cue index SubRip puts on its own line. Doing this
 * here rather than shelling out means external subtitles still work when ffmpeg
 * is missing.
 */
export function srtToVtt(source: string): { vtt: string; cues: number } {
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n{2,}/)

  const out: string[] = ['WEBVTT', '']
  let cues = 0

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    if (lines.length === 0) continue

    const timingIndex = lines.findIndex((line) => SRT_TIMING.test(line.trim()))
    if (timingIndex === -1) continue

    const match = SRT_TIMING.exec(lines[timingIndex]!.trim())!
    const text = lines.slice(timingIndex + 1)
    if (text.length === 0) continue

    // The index line is dropped: WebVTT allows an identifier but the number
    // carries no meaning, and omitting it avoids clashing with cue settings.
    out.push(`${srtTimeToVtt(match[1]!)} --> ${srtTimeToVtt(match[2]!)}`)
    out.push(...text)
    out.push('')
    cues += 1
  }

  return { vtt: out.join('\n'), cues }
}

export function isWebVtt(source: string): boolean {
  return source.trimStart().startsWith('WEBVTT')
}

function countCues(vtt: string): number {
  return (vtt.match(/-->/g) ?? []).length
}

/** ffmpeg reads formats the built-in converter does not, such as ASS and SAMI. */
async function convertWithFfmpeg(filePath: string, encoding: string): Promise<string> {
  const { ffmpeg } = binaries()
  if (!ffmpeg) throw new Error('This subtitle format needs ffmpeg, which was not found')

  return new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel', 'error',
        // Telling ffmpeg the encoding avoids a second, worse guess on its side.
        '-sub_charenc', encoding === 'utf-8' ? 'UTF-8' : 'WINDOWS-1254',
        '-i', filePath,
        '-map', '0:s:0',
        '-f', 'webvtt',
        'pipe:1'
      ],
      { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(new Error(errorMessage(error)))
        else resolve(stdout)
      }
    )
  })
}

export async function loadSubtitleFile(filePath: string): Promise<ExternalSubtitle> {
  const bytes = await readFile(filePath)
  const { text, encoding } = decodeSubtitleBytes(bytes)
  const extension = extname(filePath).toLowerCase()

  let vtt: string

  if (isWebVtt(text)) {
    vtt = text
  } else if (NATIVE.has(extension)) {
    vtt = srtToVtt(text).vtt
  } else {
    vtt = await convertWithFfmpeg(filePath, encoding)
  }

  const cues = countCues(vtt)

  // A file that parsed to nothing is almost always the wrong format rather than
  // an empty subtitle, so say so instead of silently showing no text.
  if (cues === 0) {
    throw new Error('No subtitles were found in that file. It may be an unsupported format.')
  }

  log.info(`loaded ${basename(filePath)}: ${cues} cues, ${encoding}`)

  return {
    label: basename(filePath, extension),
    filePath,
    vtt,
    cues
  }
}
