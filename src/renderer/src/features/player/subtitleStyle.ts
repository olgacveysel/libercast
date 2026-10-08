import type { AppSettings } from '@shared/types'

/**
 * How the subtitle text is drawn.
 *
 * The browser renders cues itself, through the `::cue` pseudo-element, and only
 * a short list of properties applies there — colour, background, font, opacity
 * and text-shadow among them. Position is *not* on that list: where a line sits
 * is decided by the cue's own `line`/`position` settings inside the file, so
 * this offers nothing that pretends to move it.
 *
 * `::cue` also sits outside the normal cascade, and custom properties do not
 * reach it reliably in Chromium — so these values are written into a real
 * stylesheet as literal declarations rather than as `var()` references.
 */
export interface SubtitleStyle {
  /** Multiplier on the size the browser picked. It picks from the video's height. */
  scale: number
  /** Text colour. */
  color: string
  /** Colour of the box behind the text. */
  background: string
  /** How opaque that box is. 0 means no box at all. */
  backgroundOpacity: number
  /** What keeps the text readable when there is no box behind it. */
  edge: SubtitleEdge
  font: SubtitleFont
}

export type SubtitleEdge = 'none' | 'shadow' | 'outline'
export type SubtitleFont = 'sans' | 'serif' | 'mono'

/** The smallest and largest sizes offered. */
export const MIN_SUBTITLE_SCALE = 0.6
export const MAX_SUBTITLE_SCALE = 2.6

/** The sizes the picker offers, as multipliers. */
export const SUBTITLE_SCALES: number[] = [0.8, 1, 1.25, 1.5, 2]

const FONT_STACKS: Record<SubtitleFont, string> = {
  // A humanist sans first: subtitles are read in a glance, at a distance, and
  // often over a busy picture.
  sans: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Mono", Consolas, "Courier New", monospace'
}

/**
 * Brings whatever is in the settings file into range.
 *
 * Settings are JSON on disk and can be edited by hand, and a bad value here
 * does not fail loudly — it produces subtitles that are invisible or fill the
 * screen. So every field is checked rather than trusted.
 */
export function normalizeSubtitleStyle(settings: Partial<AppSettings>): SubtitleStyle {
  return {
    scale: clampScale(settings.subtitleScale),
    color: colorOr(settings.subtitleColor, '#ffffff'),
    background: colorOr(settings.subtitleBackground, '#000000'),
    backgroundOpacity: clampUnit(settings.subtitleBackgroundOpacity, 0.72),
    edge: settings.subtitleEdge === 'shadow' || settings.subtitleEdge === 'outline' || settings.subtitleEdge === 'none'
      ? settings.subtitleEdge
      : 'shadow',
    font: settings.subtitleFont === 'serif' || settings.subtitleFont === 'mono' ? settings.subtitleFont : 'sans'
  }
}

export function clampScale(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 1
  return Math.min(MAX_SUBTITLE_SCALE, Math.max(MIN_SUBTITLE_SCALE, number))
}

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

/**
 * Accepts only a plain hex colour.
 *
 * Anything else is refused rather than passed through, because these strings
 * are interpolated into a stylesheet: a value carrying a brace or a semicolon
 * could close the rule and start another one.
 */
function colorOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text) ? text.toLowerCase() : fallback
}

/** `#rgb` or `#rrggbb` to `rgba(r, g, b, a)`. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const int = Number.parseInt(full, 16)
  if (!Number.isFinite(int)) return `rgba(0, 0, 0, ${alpha})`
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`
}

/**
 * The outline, drawn with text-shadow.
 *
 * `-webkit-text-stroke` would be the direct way to do this, but it thins the
 * letterforms from the inside and is not among the properties `::cue` honours
 * everywhere. Eight offset copies of the shadow give the same read at a size
 * where subtitles are actually looked at.
 */
function edgeShadow(edge: SubtitleEdge, color: string): string | null {
  if (edge === 'none') return null

  // The edge is drawn in the opposite tone to the text, so it works whether the
  // user chose white text or black.
  const dark = isDark(color)
  const ink = dark ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.9)'

  if (edge === 'shadow') return `0 0.08em 0.12em ${ink}`

  const offsets = [
    '-0.045em -0.045em', '0 -0.05em', '0.045em -0.045em',
    '-0.05em 0', '0.05em 0',
    '-0.045em 0.045em', '0 0.05em', '0.045em 0.045em'
  ]
  return offsets.map((offset) => `${offset} 0 ${ink}`).join(', ')
}

function isDark(hex: string): boolean {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const int = Number.parseInt(full, 16)
  if (!Number.isFinite(int)) return false
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255]
  // Rec. 709 luma: green carries most of the perceived brightness.
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128
}

/**
 * The stylesheet text for one style.
 *
 * Kept as a pure string builder so the whole feature can be checked without a
 * browser, and so what lands in the document is inspectable in a test.
 */
export function subtitleCss(style: SubtitleStyle): string {
  const declarations = [
    `font-family: ${FONT_STACKS[style.font]}`,
    `font-size: ${round(style.scale)}em`,
    `color: ${style.color}`,
    `background: ${style.backgroundOpacity <= 0 ? 'transparent' : withAlpha(style.background, round(style.backgroundOpacity))}`,
    'line-height: 1.35'
  ]

  const shadow = edgeShadow(style.edge, style.color)
  if (shadow) declarations.push(`text-shadow: ${shadow}`)

  return `video::cue {\n  ${declarations.join(';\n  ')};\n}\n`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Inline style for a preview of the same settings, in ordinary markup.
 *
 * The preview cannot be a real cue, so it is the same declarations expressed as
 * a style object. Sizes are in rem here rather than em, because there is no
 * video height for the browser to have picked a base size from.
 */
export function subtitlePreviewStyle(style: SubtitleStyle): Record<string, string> {
  const shadow = edgeShadow(style.edge, style.color)
  return {
    fontFamily: FONT_STACKS[style.font],
    fontSize: `${round(style.scale * 1.05)}rem`,
    color: style.color,
    background:
      style.backgroundOpacity <= 0 ? 'transparent' : withAlpha(style.background, round(style.backgroundOpacity)),
    lineHeight: '1.35',
    ...(shadow ? { textShadow: shadow } : {})
  }
}
