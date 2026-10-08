/**
 * Dates, times and counts, in the language the interface is using.
 *
 * The locale is held here rather than passed to every call site: these are used
 * from dozens of components, most of which have no other reason to know which
 * language is active. The settings code sets it whenever the language changes.
 */
let locale: string | undefined

export function setFormatLocale(next: string | undefined): void {
  locale = next
}

/** Relative wording, per language. Short by design — these sit in tight rows. */
const RELATIVE: Record<string, { never: string; now: string; m: string; h: string; d: string }> = {
  tr: { never: 'hiç', now: 'az önce', m: '{n} dk önce', h: '{n} sa önce', d: '{n} gün önce' },
  de: { never: 'nie', now: 'gerade eben', m: 'vor {n} Min.', h: 'vor {n} Std.', d: 'vor {n} T.' },
  en: { never: 'never', now: 'just now', m: '{n}m ago', h: '{n}h ago', d: '{n}d ago' }
}

function relativeWords(): { never: string; now: string; m: string; h: string; d: string } {
  const language = (locale ?? 'en').slice(0, 2)
  return RELATIVE[language] ?? RELATIVE.en!
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

export function formatRelative(timestamp: number | null): string {
  const words = relativeWords()
  if (!timestamp) return words.never

  const minutes = Math.round((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return words.now
  if (minutes < 60) return words.m.replace('{n}', String(minutes))

  const hours = Math.round(minutes / 60)
  if (hours < 24) return words.h.replace('{n}', String(hours))
  return words.d.replace('{n}', String(Math.round(hours / 24)))
}

export function formatCount(value: number): string {
  return value.toLocaleString(locale)
}

/** 0..1 through a program's runtime, clamped. */
export function programProgress(startsAt: number, endsAt: number): number {
  const total = endsAt - startsAt
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, (Date.now() - startsAt) / total))
}

export function initials(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}
