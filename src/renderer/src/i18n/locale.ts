import type { AppSettings } from '@shared/types'

export type Language = AppSettings['language']

/**
 * Locale tag for dates and numbers.
 *
 * Kept in its own module, free of any store import, so the settings code can
 * use it without the store and the translator importing each other in a circle.
 */
export function localeOf(language: Language): string {
  switch (language) {
    case 'tr':
      return 'tr-TR'
    case 'de':
      return 'de-DE'
    default:
      return 'en-GB'
  }
}
