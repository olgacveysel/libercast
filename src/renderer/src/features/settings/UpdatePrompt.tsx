import type { JSX } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'
import { useT } from '@renderer/i18n'

/**
 * The one time this application asks to be allowed to talk to the internet on
 * its own.
 *
 * It is a strip rather than a dialog on purpose. A modal on first launch, in
 * front of someone who has not seen a single channel yet, demands an answer to
 * a question they have no context for — and the honest default if they ignore
 * it is "no", which a modal cannot express.
 *
 * Either answer settles it for good. There is no third state to return to,
 * because an application that keeps asking has not really taken no for an
 * answer.
 */
export function UpdatePrompt(): JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const t = useT()

  if (settings.autoCheckUpdates !== null) return null

  return (
    <div className="updatebar updatebar--ask" role="status">
      <span>{t('settings.autoUpdateAsk')}</span>

      <button className="btn btn--primary" onClick={() => void updateSettings({ autoCheckUpdates: true })}>
        {t('settings.autoUpdateYes')}
      </button>

      <button className="btn" onClick={() => void updateSettings({ autoCheckUpdates: false })}>
        {t('settings.autoUpdateNo')}
      </button>
    </div>
  )
}
