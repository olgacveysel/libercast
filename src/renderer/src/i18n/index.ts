import { useCallback } from 'react'
import type { AppSettings } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import type { TranslationKey } from './en'
import { translate } from './translate'

export type { TranslationKey } from './en'
export { translate }

export { localeOf } from './locale'
export type { Language } from './locale'

type Language = AppSettings['language']

/** The languages offered, in the order the picker shows them. */
export const LANGUAGES: { code: Language; label: string }[] = [
  // Each is written in its own language: someone who has landed in the wrong
  // one needs to recognise their own without being able to read the rest.
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'de', label: 'Deutsch' }
]

/**
 * The translator for the language currently chosen.
 *
 * Reading it from the store rather than a module variable is what makes the
 * interface change the moment the setting does, without a restart.
 */
export function useT(): (key: TranslationKey, vars?: Record<string, string | number>) => string {
  const language = useAppStore((state) => state.settings.language)
  return useCallback((key, vars) => translate(language, key, vars), [language])
}

/** The chosen language on its own, for date and number formatting. */
export function useLanguage(): Language {
  return useAppStore((state) => state.settings.language)
}

/** Keeps the document in step, which is what screen readers and CSS read. */
export function applyLanguage(language: Language): void {
  document.documentElement.lang = language
}
