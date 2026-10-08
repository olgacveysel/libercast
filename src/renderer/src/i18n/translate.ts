import { en, type TranslationKey } from './en'
import { tr } from './tr'
import { de } from './de'
import type { Language } from './locale'

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { en, tr, de }

/**
 * Looks up a string and fills in its placeholders.
 *
 * Separate from the React hook so it can be tested, and used from the few
 * places that are not components.
 *
 * English is the fallback for a key a language somehow lacks — the dictionaries
 * are typed so that should not happen — and the key itself is the last resort,
 * which makes a missing string obvious on screen rather than a blank gap.
 */
export function translate(
  language: Language,
  key: TranslationKey,
  vars?: Record<string, string | number>
): string {
  const text = DICTIONARIES[language]?.[key] ?? en[key] ?? key
  if (!vars) return text

  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  )
}
