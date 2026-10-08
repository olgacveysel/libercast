import { execFile } from 'node:child_process'
import type { MediaTrack, MediaTracks, VideoInfo } from '@shared/types'
import type { StreamCodecs, InputOptions } from './args'
import { binaries } from './binaries'
import { buildProbeArgs, looksLikeBadOption, rejectOption } from './args'
import { languageName, normalizeLanguage } from './languages'
import { readProbe, writeProbe } from '@main/db/repo/probeCache'
import { createLogger, errorMessage } from '@main/util/logger'

const log = createLogger('probe')

interface FfprobeStream {
  index?: number
  codec_type?: string
  codec_name?: string
  channels?: number
  width?: number
  height?: number
  /** "25/1" or "30000/1001". Averaged rate; r_frame_rate is the declared one. */
  avg_frame_rate?: string
  r_frame_rate?: string
  bit_rate?: string
  tags?: { language?: string; title?: string; LANGUAGE?: string; TITLE?: string }
  disposition?: { default?: number; forced?: number }
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string; bit_rate?: string; format_name?: string }
}

export interface ProbeResult extends StreamCodecs {
  tracks: MediaTracks
  videoInfo: VideoInfo | null
  /**
   * False when ffprobe could not open the URL at all.
   *
   * This has to be distinguishable from a successful probe that found nothing,
   * because the two need opposite responses: unknown codecs on a stream that
   * opens mean "re-encode to be safe", while a URL that will not open means the
   * transcode is pointless and the real cause has to be found and shown.
   */
  ok: boolean
  /** ffprobe's own complaint, kept for the diagnostic. */
  error: string | null
}

/**
 * Subtitle codecs that carry text, and so can be converted to WebVTT. Everything
 * else (PGS, DVD/VobSub, DVB) is a picture and can only be burned in.
 */
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'mov_text',
  'webvtt',
  'text',
  'stl',
  'subviewer',
  'microdvd',
  'dvb_teletext'
])

const cache = new Map<string, { result: ProbeResult; at: number }>()
const CACHE_TTL_MS = 5 * 60_000

/**
 * Whether the stored answer may be used instead of asking the provider again.
 *
 * Off by default only in the sense that it can be disabled; the point of the
 * cache is that identifying a stream costs a connection, and on a
 * connection-limited account that is the connection playback needs.
 */
let useStoredProbes = true

export function setStoredProbesEnabled(enabled: boolean): void {
  useStoredProbes = enabled
}
const PROBE_TIMEOUT_MS = 15_000

/** Cache key that never contains credentials. */
function keyOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return url
  }
}

function failed(error: string): ProbeResult {
  return {
    video: null,
    audio: null,
    durationSecs: null,
    tracks: { audio: [], subtitle: [] },
    videoInfo: null,
    container: null,
    ok: false,
    error
  }
}

/**
 * Identifies codecs and enumerates every audio and subtitle track.
 *
 * A failure is not fatal: unknown codecs simply mean the conservative
 * re-encoding path is taken and the track pickers stay empty.
 */
export async function probeStream(url: string, options: InputOptions = {}): Promise<ProbeResult> {
  const key = keyOf(url)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result

  // Answered on a previous run. Using it saves a connection to the provider,
  // which on most accounts is the one playback is about to need.
  if (useStoredProbes) {
    const stored = readStored(key)
    if (stored) {
      cache.set(key, { result: stored, at: Date.now() })
      log.debug(`reusing the stored identification of ${key}`)
      return stored
    }
  }

  const { ffprobe } = binaries()
  if (!ffprobe) return failed('ffprobe is not available')

  let result = await runProbe(ffprobe, url, options)

  // ffprobe refused an option rather than the stream. Every later ffmpeg and
  // ffprobe call would fail the same way, so the offending option is dropped
  // for the rest of the session and this one call is retried immediately.
  // Retried a few times because a build may dislike more than one of them.
  for (let i = 0; i < 4 && !result.ok && looksLikeBadOption(result.error ?? ''); i++) {
    const dropped = rejectOption(result.error ?? '')
    if (!dropped) break
    log.warn(`this ffmpeg build does not support -${dropped}; continuing without it`)
    result = await runProbe(ffprobe, url, options)
  }

  // A failure is not cached: it is usually transient (a busy provider, a
  // momentary connection limit) and caching it would keep the item unplayable
  // for five minutes after the cause cleared.
  if (result.ok) {
    cache.set(key, { result, at: Date.now() })
    // Live entries expire far sooner than VOD; the provider can change a live
    // encode at any time, whereas a film is what it is.
    writeStored(key, result, result.durationSecs === null)
  }
  return result
}

function runProbe(ffprobe: string, url: string, options: InputOptions): Promise<ProbeResult> {
  const key = keyOf(url)

  return new Promise<ProbeResult>((resolve) => {
    execFile(
      ffprobe,
      buildProbeArgs(url, options),
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || errorMessage(error)).trim().split('\n').slice(-2).join(' | ')
          log.warn(`probe failed for ${key}`, detail)
          resolve(failed(detail || 'ffprobe could not open the stream'))
          return
        }

        try {
          resolve(parseProbeOutput(stdout))
        } catch {
          resolve(failed('ffprobe returned output that could not be read'))
        }
      }
    )
  })
}

export function parseProbeOutput(json: string): ProbeResult {
  const parsed = JSON.parse(json) as FfprobeOutput
  const streams = parsed.streams ?? []
  const duration = Number(parsed.format?.duration)

  const audio = streams.filter((s) => s.codec_type === 'audio').map(toTrack)
  const subtitle = streams.filter((s) => s.codec_type === 'subtitle').map(toTrack)

  // Index is the position within the type, because that is what `-map 0:a:N`
  // and `-map 0:s:N` address — not the absolute stream index.
  audio.forEach((track, index) => (track.index = index))
  subtitle.forEach((track, index) => (track.index = index))

  const videoStream = streams.find((s) => s.codec_type === 'video')

  return {
    video: videoStream?.codec_name ?? null,
    audio: audio[0]?.codec ?? null,
    durationSecs: Number.isFinite(duration) && duration > 0 ? duration : null,
    tracks: { audio, subtitle },
    videoInfo: videoStream ? toVideoInfo(videoStream, parsed.format?.bit_rate) : null,
    // Decides whether AAC needs the ADTS-to-ASC conversion: only MPEG-TS
    // carries it in that framing.
    container: parsed.format?.format_name ?? null,
    ok: true,
    error: null
  }
}

/** ffprobe states frame rates as a rational string, e.g. "30000/1001". */
export function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null
  const [numerator, denominator] = value.split('/').map(Number)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !denominator) return null
  const fps = numerator! / denominator!
  return fps > 0 && fps < 1000 ? Math.round(fps * 1000) / 1000 : null
}

function toVideoInfo(stream: FfprobeStream, formatBitrate: string | undefined): VideoInfo {
  // The average rate is what the stream actually carries; the declared rate can
  // be nonsense on live sources (90000/1 shows up regularly).
  const fps = parseFrameRate(stream.avg_frame_rate) ?? parseFrameRate(stream.r_frame_rate)
  const bitrate = Number(stream.bit_rate ?? formatBitrate ?? '')

  return {
    codec: stream.codec_name ?? null,
    width: stream.width ?? null,
    height: stream.height ?? null,
    fps,
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null
  }
}

function toTrack(stream: FfprobeStream): MediaTrack {
  const language = normalizeLanguage(stream.tags?.language ?? stream.tags?.LANGUAGE)
  const title = (stream.tags?.title ?? stream.tags?.TITLE ?? '').trim() || null
  const codec = stream.codec_name ?? 'unknown'
  const isForced = stream.disposition?.forced === 1

  return {
    index: 0,
    codec,
    language,
    title,
    label: buildLabel(language, title, stream, isForced),
    channels: stream.channels ?? null,
    isDefault: stream.disposition?.default === 1,
    isForced,
    isTextBased: TEXT_SUBTITLE_CODECS.has(codec)
  }
}

/**
 * What the picker shows. The container's own title is often more useful than
 * the language alone ("English (Director's Commentary)"), so it is kept when
 * it adds something.
 */
function buildLabel(
  language: string | null,
  title: string | null,
  stream: FfprobeStream,
  isForced: boolean
): string {
  const parts: string[] = [languageName(language)]

  if (title && title.toLowerCase() !== parts[0]!.toLowerCase()) parts.push(title)
  if (isForced) parts.push('Forced')

  if (stream.codec_type === 'audio') {
    const channels = stream.channels
    if (channels === 6) parts.push('5.1')
    else if (channels === 8) parts.push('7.1')
    else if (channels === 1) parts.push('Mono')
  }

  const [name, ...rest] = parts
  return rest.length > 0 ? `${name} (${rest.join(', ')})` : name!
}

export function clearProbeCache(): void {
  cache.clear()
}

/**
 * The stored copy is a convenience, never a requirement: if the database is not
 * open yet — during a test, or before the first window — probing simply happens
 * the slow way.
 */
function readStored(key: string): ProbeResult | null {
  try {
    return readProbe<ProbeResult>(key)
  } catch {
    return null
  }
}

function writeStored(key: string, result: ProbeResult, isLive: boolean): void {
  try {
    writeProbe(key, result, isLive)
  } catch {
    // Not being able to remember is not a reason to fail the playback.
  }
}
