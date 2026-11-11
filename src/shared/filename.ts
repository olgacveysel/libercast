/**
 * Turning a programme into a filename a filesystem will actually accept.
 *
 * This used to be two functions with the same name in two modules, each
 * stripping the characters its author remembered. Between them they missed the
 * rules that actually bite on Windows, which is the platform most of this
 * application's users are on:
 *
 * - Reserved device names. `CON`, `PRN`, `AUX`, `NUL`, `COM1`..`COM9` and
 *   `LPT1`..`LPT9` cannot be files, with or without an extension. A programme
 *   called "Aux" produced a recording Windows refused to create, and the error
 *   surfaced from ffmpeg as a failure to open the output — which points at the
 *   stream, not at its name.
 * - Trailing dots and spaces. Windows silently strips them on create and then
 *   cannot find the file it was asked to write.
 * - Length in bytes, not characters. A path limit is in bytes, and a Turkish
 *   or German title is longer in UTF-8 than it looks.
 */

/**
 * Characters that separate things, replaced with a space rather than removed.
 *
 * Someone writing `{year}/{title}` means a boundary. Deleting the slash fuses
 * the two into `2026The Big Match`, which reads as a mistake nobody can
 * explain; a space keeps the meaning even though the folder they may have
 * been imagining is not created.
 */
const SEPARATORS = /[/\\:|]/g

/** Characters no common filesystem accepts, and which separate nothing. */
const ILLEGAL = /[<>"?*]/g
// eslint-disable-next-line no-control-regex -- the control range is the point
const CONTROL = /[\u0000-\u001f\u007f]/g

/**
 * Names Windows reserves for devices, with or without an extension.
 *
 * Matched case-insensitively and on the stem alone, because `con.ts` is just
 * as refused as `CON`.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Leaves room for the directory, the extension and a collision suffix. */
const MAX_BYTES = 120

export interface NameParts {
  channel: string
  title: string
  /** Unix ms. Rendered in local time, because that is the clock people read. */
  at: number
}

/** The default, and the one every existing recording was named by. */
export const DEFAULT_TEMPLATE = '{channel} - {title} ({date} {time})'

/** Every token a template may use, with a short description for the UI. */
export const TOKENS = [
  'channel',
  'title',
  'date',
  'time',
  'year',
  'month',
  'day'
] as const

export type Token = (typeof TOKENS)[number]

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** What each token expands to. Local time throughout. */
export function tokenValues(parts: NameParts): Record<Token, string> {
  const when = new Date(parts.at)
  const year = String(when.getFullYear())
  const month = two(when.getMonth() + 1)
  const day = two(when.getDate())

  return {
    channel: parts.channel,
    title: parts.title,
    date: `${year}-${month}-${day}`,
    // Colons are not allowed in a filename, so the separator is a dash.
    time: `${two(when.getHours())}-${two(when.getMinutes())}`,
    year,
    month,
    day
  }
}

/**
 * Fills a template, then makes the result safe.
 *
 * An unknown token is left as written rather than replaced with a blank: a
 * user who typed `{titel}` should see their mistake in the filename, not a
 * silently shortened name they cannot explain.
 */
export function renderTemplate(
  template: string | null | undefined,
  parts: NameParts
): string {
  const values = tokenValues(parts)
  // Tolerant of a missing template on purpose. Settings reach the renderer
  // over IPC, and a blob written before this setting existed simply has no
  // such field — which took the whole settings screen down with a TypeError
  // rather than quietly using the default.
  const filled = ((template ?? '').trim() || DEFAULT_TEMPLATE).replace(
    /\{([a-z]+)\}/gi,
    (whole, token: string) => {
      const key = token.toLowerCase() as Token
      return key in values ? values[key] : whole
    }
  )

  return sanitize(filled)
}

/**
 * Makes any string usable as one path segment.
 *
 * Never returns an empty string: a name that sanitises away to nothing — a
 * title that was entirely punctuation, which providers do produce — would
 * otherwise become a file called ".ts", which is hidden on Unix and refused
 * on Windows.
 */
export function sanitize(value: string): string {
  let clean = value
    .replace(SEPARATORS, ' ')
    .replace(ILLEGAL, '')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim()

  clean = truncateBytes(clean, MAX_BYTES)

  // Windows strips these on create and then cannot find what it wrote.
  clean = clean.replace(/[. ]+$/, '')

  if (clean === '') return 'Recording'
  if (RESERVED.test(clean)) return `${clean}_`
  return clean
}

/**
 * Cuts to a byte budget without splitting a character.
 *
 * Filesystem limits are in bytes. "Çınar Kanalı" is twelve characters and
 * fifteen bytes, and a cut made by character count can land halfway through
 * one — producing a name the filesystem rejects for a different reason than
 * the one being avoided.
 */
export function truncateBytes(value: string, max: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(value).length <= max) return value

  let out = ''
  let used = 0
  for (const character of value) {
    const size = encoder.encode(character).length
    if (used + size > max) break
    out += character
    used += size
  }
  return out.trim()
}

/**
 * The tokens a template actually uses, in order, ignoring unknown ones.
 * The settings screen uses this to warn about a template that names nothing.
 */
export function tokensUsed(template: string): Token[] {
  const found: Token[] = []
  for (const match of template.matchAll(/\{([a-z]+)\}/gi)) {
    const key = match[1]!.toLowerCase() as Token
    if (TOKENS.includes(key) && !found.includes(key)) found.push(key)
  }
  return found
}
