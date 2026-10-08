/**
 * Progressive WebVTT reader.
 *
 * ffmpeg produces subtitle cues as it works through the stream, so the file is
 * never "finished" while playback is live. A `<track src>` element would fetch
 * the resource once and parse it whole, which for a two-hour film means no
 * subtitles until the film has been read end to end. Cues are therefore parsed
 * out of the response as it arrives and pushed into a TextTrack by hand.
 */

export interface ParsedCue {
  startSecs: number
  endSecs: number
  text: string
}

const TIMING = /^((?:\d+:)?\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{1,3})/

/** `00:01:02.500`, `01:02.500` and comma decimals all appear in the wild. */
export function parseTimestamp(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length < 2 || parts.length > 3) return null

  const seconds = Number(parts.pop())
  const minutes = Number(parts.pop())
  const hours = parts.length > 0 ? Number(parts.pop()) : 0

  if (![seconds, minutes, hours].every(Number.isFinite)) return null
  return hours * 3600 + minutes * 60 + seconds
}

/** Strips the inline markup WebVTT allows, which a TextTrack cue cannot show. */
function cleanText(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/<\/?(?:v|c|b|i|u|ruby|rt|lang)(?:[^>]*)>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/**
 * Parses whole cues out of a growing buffer, returning them along with the
 * unconsumed tail. A cue is only emitted once its terminating blank line has
 * arrived, so a half-received cue is never shown.
 */
export function parseCueBlocks(buffer: string): { cues: ParsedCue[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n\n+/)

  // The final block may be incomplete, so it goes back into the buffer.
  const rest = blocks.pop() ?? ''
  const cues: ParsedCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    if (lines.length === 0) continue

    // Skip the WEBVTT header, NOTE comments and STYLE/REGION blocks.
    const first = lines[0]!.trim()
    if (/^WEBVTT/i.test(first) || /^(NOTE|STYLE|REGION)\b/i.test(first)) continue

    let timingIndex = lines.findIndex((line) => TIMING.test(line.trim()))
    if (timingIndex === -1) continue

    const match = TIMING.exec(lines[timingIndex]!.trim())!
    const startSecs = parseTimestamp(match[1]!)
    const endSecs = parseTimestamp(match[2]!)
    if (startSecs === null || endSecs === null || endSecs <= startSecs) continue

    const text = cleanText(lines.slice(timingIndex + 1))
    if (text) cues.push({ startSecs, endSecs, text })
  }

  return { cues, rest }
}

export interface SubtitleStreamOptions {
  url: string
  signal: AbortSignal
  /** Cues are shifted by this much, matching a session opened at an offset. */
  offsetSecs: number
  onCue: (cue: ParsedCue) => void
}

export async function streamSubtitles(options: SubtitleStreamOptions): Promise<void> {
  const response = await fetch(options.url, { signal: options.signal })
  if (!response.ok || !response.body) throw new Error(`Subtitle stream failed (${response.status})`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const { cues, rest } = parseCueBlocks(buffer)
    buffer = rest

    for (const cue of cues) {
      options.onCue({
        startSecs: cue.startSecs + options.offsetSecs,
        endSecs: cue.endSecs + options.offsetSecs,
        text: cue.text
      })
    }
  }

  // Flush a trailing cue that arrived without its blank line.
  const { cues } = parseCueBlocks(`${buffer}\n\n`)
  for (const cue of cues) {
    options.onCue({
      startSecs: cue.startSecs + options.offsetSecs,
      endSecs: cue.endSecs + options.offsetSecs,
      text: cue.text
    })
  }
}
