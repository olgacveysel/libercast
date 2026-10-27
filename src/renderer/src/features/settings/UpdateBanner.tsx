import { useEffect, useState, type JSX } from 'react'
import { bannerUpdate } from '@shared/releases'
import { invoke, subscribe } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/useAppStore'
import { useT } from '@renderer/i18n'
import { IconClose } from '@renderer/ui/Icon'

/**
 * Says, once, that a newer version exists.
 *
 * Only ever appears for someone who asked to be told: the check behind it does
 * not run until the first-run prompt has been answered yes. Dismissing it is
 * remembered per version, so waving away a beta does not also silence the one
 * after it.
 */
export function UpdateBanner(): JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [version, setVersion] = useState<string | null>(null)
  const t = useT()

  useEffect(() => {
    void invoke('app:version').then(setVersion).catch(() => setVersion(null))
  }, [])

  // The launch check finishes a second or two after the window opens, so what
  // it finds arrives as an event rather than being there to read at startup.
  useEffect(
    () =>
      subscribe('updates:available', (update) => {
        void updateSettings({
          knownUpdateVersion: update.version,
          knownUpdateUrl: update.url
        })
      }),
    [updateSettings]
  )

  if (version === null) return null

  const update = bannerUpdate(settings, version)
  if (!update) return null

  return (
    <div className="updatebar" role="status">
      <span>{t('settings.updateFound', { version: update.version })}</span>

      <a className="btn btn--primary" href={update.url} target="_blank" rel="noreferrer">
        {t('settings.updateOpen')}
      </a>

      <button
        className="updatebar__close"
        onClick={() => void updateSettings({ dismissedUpdate: update.version })}
        title={t('common.close')}
        aria-label={t('common.close')}
      >
        <IconClose size={13} />
      </button>
    </div>
  )
}
