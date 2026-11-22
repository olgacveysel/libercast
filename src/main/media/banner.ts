/**
 * Reading what ffmpeg says about a stream it has just opened.
 *
 * On an account that allows one connection at a time, LiberCast does not
 * probe a live channel before playing it: ffprobe and ffmpeg in quick
 * succession is two connections, and the second is the one the provider
 * refuses. So the channel is played on a guess — h264 and AAC, which is what
 * broadcast MPEG-TS almost always is — and when the guess is wrong the copy
 * fails at the muxer, the stream is reopened, and it is re-encoded instead.
 *
 * That recovery works. What it never did was *learn*: nothing was written
 * down, so the same channel repeated the whole sequence on every open — a
 * wasted attempt at tune-in and a full re-encode for as long as it played.
 *
 * But the identification was never actually unavailable. ffmpeg prints it, on
 * stderr, in the first moments of the connection already open — the same
 * codecs, resolution, profile, pixel format, field order and track list that
 * ffprobe would have charged a second connection for. This reads that banner
 * and shapes it like ffprobe's own JSON, so `parseProbeOutput` applies every
 * rule it already applies to a real probe rather than this file growing a
 * second, drifting copy of them.
 *
 * It is a free second-best: fewer fields than ffprobe reports, no connection
 * spent, and from the second play onwards the plan is right the first time.
 */
import type { ProbeResult } from './probe'
import { parseProbeOutput } from './probe'

/** `Input #0, mpegts, from 'http://…':` */
const INPUT_LINE = /^Input #(\d+),\s*([^,]+(?:,[^,]+)*?),\s*from\s/
/** `Duration: 00:00:01.02, start: -0.023000, bitrate: 416 kb/s` */
const DURATION_LINE = /^\s*Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)|^\s*Duration:\s*(N\/A)/
const BITRATE_IN_DURATION = /bitrate:\s*(\d+)\s*kb\/s/
/** `Stream #0:1[0x101](tur): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s` */
const STREAM_LINE =
  /^\s*Stream #(\d+):(\d+)(?:\[[^\]]*\])?(?:\(([^)]*)\))?:\s*(Video|Audio|Subtitle):\s*(.*)$/
/** `    title           : Director's commentary` */
const METADATA_LINE = /^\s{6,}([A-Za-z_][\w-]*)\s*:\s*(.*)$/

/** Everything after this belongs to the output, not to what was opened. */
const END_OF_INPUTS = /^(Output #|Stream mapping:|Press \[q\])/

interface Stream {
  codec_type: string
  codec_name?: string
  channels?: number
  width?: number
  height?: number
  r_frame_rate?: string
  bit_rate?: string
  profile?: string
  pix_fmt?: string
  field_order?: string
  tags?: { language?: string; title?: string }
  disposition?: { default?: number; forced?: number }
}

/** ffmpeg writes a layout; ffprobe writes a count, which is what the label wants. */
const CHANNEL_COUNTS: Record<string, number> = {
  mono: 1,
  stereo: 2,
  '2.1': 3,
  '3.0': 3,
  '4.0': 4,
  quad: 4,
  '5.0': 5,
  '5.1': 6,
  '6.1': 7,
  '7.1': 8
}

/**
 * ffmpeg's words for the field order, in the pixel-format parenthetical.
 *
 * Only the two it actually prints are mapped. Anything else stays unset, so
 * the Source line says nothing rather than claiming progressive — the same
 * care `toVideoInfo` takes with ffprobe's 'unknown'.
 */
const FIELD_ORDERS: Record<string, string> = {
  progressive: 'progressive',
  'top first': 'tt',
  'bottom first': 'bb',
  'top coded first (swapped)': 'tb',
  'bottom coded first (swapped)': 'bt'
}

/**
 * Splits a stream description on its commas, ignoring the ones inside
 * brackets.
 *
 * `yuv420p(tv, bt709, top first)` is one field containing two commas, and a
 * plain split turns it into three meaningless pieces — which is how the pixel
 * format and the field order went missing on exactly the broadcast streams
 * this was written for. A progressive clip survives a naive split, because
 * `(progressive)` has no comma in it, so the mistake passes every test made
 * from a generated file and fails on real television.
 */
function fields(description: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < description.length; i++) {
    const c = description[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      out.push(description.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(description.slice(start).trim())
  return out.filter((p) => p !== '')
}

function channelsOf(parts: string[]): number | undefined {
  for (const part of parts) {
    // "5.1(side)" and "5.1" are the same count.
    const layout = part.replace(/\(.*\)$/, '').trim()
    if (layout in CHANNEL_COUNTS) return CHANNEL_COUNTS[layout]
  }
  return undefined
}

/**
 * The codec name, and the profile ffmpeg puts in brackets after it.
 *
 * `h264 (High)` and `h264 (High 4:4:4 Predictive)` are a codec and a profile;
 * `aac (LC)` is the same shape. The second bracket, when there is one, is the
 * fourcc — `(avc1 / 0x31637661)` — and is not wanted.
 */
function codecOf(description: string): { name: string; profile?: string } {
  const match = /^([A-Za-z0-9_]+)(?:\s+\(([^)]+)\))?/.exec(description.trim())
  if (!match) return { name: description.trim().split(/[\s,]/)[0] ?? '' }
  const profile = match[2]
  // A fourcc rather than a profile: it holds a slash, or is pure hex.
  const looksLikeFourcc = profile !== undefined && /\/|^0x/.test(profile)
  return { name: match[1]!, profile: looksLikeFourcc ? undefined : profile }
}

function videoDetails(rest: string, stream: Stream): void {
  const parts = fields(rest)

  for (const part of parts.slice(1)) {
    // "yuv420p(tv, bt709, top first)" — the format, then whatever it declares.
    const pix = /^(yuv[\w]*|gbr[\w]*|rgb[\w]*|gray[\w]*|nv\d+[\w]*|p0\d+[\w]*)(?:\((.*)\))?$/.exec(part)
    if (pix) {
      stream.pix_fmt = pix[1]
      for (const flag of (pix[2] ?? '').split(',').map((f) => f.trim().toLowerCase())) {
        if (flag in FIELD_ORDERS) stream.field_order = FIELD_ORDERS[flag]
      }
      continue
    }

    const size = /^(\d{2,5})x(\d{2,5})(?:\s|$)/.exec(part)
    if (size) {
      stream.width = Number(size[1])
      stream.height = Number(size[2])
      continue
    }

    const fps = /^([\d.]+)\s*fps$/.exec(part)
    if (fps) {
      stream.r_frame_rate = `${fps[1]}/1`
      continue
    }

    const bitrate = /^(\d+)\s*kb\/s$/.exec(part)
    if (bitrate) stream.bit_rate = String(Number(bitrate[1]) * 1000)
  }
}

/**
 * Turns an ffmpeg banner into ffprobe-shaped JSON.
 *
 * Returns null unless there is an `Input #0` with at least one stream under
 * it — a truncated banner, or stderr that is only warnings, must not be
 * mistaken for a stream that genuinely has no audio.
 */
export function bannerToProbeOutput(text: string): string | null {
  const streams: Stream[] = []
  let formatName: string | null = null
  let duration: number | null = null
  let formatBitrate: string | undefined
  let seenInput = false
  let current: Stream | null = null

  for (const raw of text.split(/\r?\n/)) {
    if (END_OF_INPUTS.test(raw)) break

    const input = INPUT_LINE.exec(raw)
    if (input) {
      // A second input would be the subtitle connection or a filter source,
      // and its streams are not the ones being described.
      if (seenInput) break
      seenInput = true
      formatName = input[2]!.trim()
      current = null
      continue
    }
    if (!seenInput) continue

    const stream = STREAM_LINE.exec(raw)
    if (stream) {
      const [, , , language, kind, rest] = stream
      const { name, profile } = codecOf(rest!)
      current = { codec_type: kind!.toLowerCase(), codec_name: name }
      if (profile) current.profile = profile
      // "und" is ffmpeg for "nothing was declared", and a picker that offers
      // "Undetermined" is worse than one that offers the track's number.
      if (language && language !== 'und') current.tags = { language }
      if (/\(default\)/.test(rest!)) current.disposition = { ...current.disposition, default: 1 }
      if (/\(forced\)/.test(rest!)) current.disposition = { ...current.disposition, forced: 1 }

      if (current.codec_type === 'video') videoDetails(rest!, current)
      else if (current.codec_type === 'audio') {
        const parts = fields(rest!)
        const channels = channelsOf(parts)
        if (channels !== undefined) current.channels = channels
        const bitrate = parts.find((p) => /^\d+\s*kb\/s$/.test(p))
        if (bitrate) current.bit_rate = String(Number.parseInt(bitrate, 10) * 1000)
      }
      streams.push(current)
      continue
    }

    if (duration === null) {
      const d = DURATION_LINE.exec(raw)
      if (d && d[1] !== undefined) {
        duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])
        const rate = BITRATE_IN_DURATION.exec(raw)
        if (rate) formatBitrate = String(Number(rate[1]) * 1000)
        continue
      }
    }

    // Indented metadata belongs to the stream above it, when there is one.
    const meta = METADATA_LINE.exec(raw)
    if (meta && current) {
      const key = meta[1]!.toLowerCase()
      const value = meta[2]!.trim()
      if (key === 'title' && value) current.tags = { ...current.tags, title: value }
      if (key === 'language' && value && value !== 'und') {
        current.tags = { ...current.tags, language: value }
      }
    }
  }

  if (!seenInput || streams.length === 0) return null

  return JSON.stringify({
    streams,
    format: {
      format_name: formatName ?? undefined,
      duration: duration === null ? undefined : String(duration),
      bit_rate: formatBitrate
    }
  })
}

/**
 * What ffmpeg found, as a probe result — or null when the banner was not
 * complete enough to be worth believing.
 *
 * A live stream has no meaningful duration, and ffmpeg reports `N/A`, so a
 * result from here carries `durationSecs: null` rather than a zero that the
 * seek bar would take as a real length.
 */
export function readInputBanner(text: string): ProbeResult | null {
  const json = bannerToProbeOutput(text)
  if (json === null) return null
  try {
    const result = parseProbeOutput(json)
    // A banner with no video stream is a connection that returned something
    // other than a channel, and storing it would teach the wrong lesson.
    return result.video === null ? null : result
  } catch {
    return null
  }
}
