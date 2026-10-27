import { useEffect, useState, type JSX } from 'react'
import type { StreamState } from './useStream'
import { useT } from '@renderer/i18n'
import { IconClose } from '@renderer/ui/Icon'

/** How long the note stays before it gets out of the way. */
const VISIBLE_MS = 7000

/**
 * Says, briefly, that the picture is coming from a different provider.
 *
 * The switch itself is silent on purpose — a dialog at the moment of a goal is
 * worse than the outage it is reporting — but saying nothing at all would hide
 * a source that keeps dying behind an application that merely feels slow to
 * start. So it is announced once, quietly, and then it leaves.
 */
export function SwitchedNotice({ switched }: { switched: StreamState['switched'] }): JSX.Element | null {
  const [shown, setShown] = useState<StreamState['switched']>(null)
  const t = useT()

  useEffect(() => {
    if (!switched) return
    setShown(switched)
    const timer = setTimeout(() => setShown(null), VISIBLE_MS)
    return () => clearTimeout(timer)
    // Keyed on the content rather than the object: a re-render that produces
    // an equal report must not restart the countdown.
  }, [switched?.channelName, switched?.from, switched?.to])

  if (!shown) return null

  return (
    <div className="switched" role="status">
      <span>{t('player.switchedSource', { from: shown.from, to: shown.to })}</span>
      <button onClick={() => setShown(null)} aria-label={t('common.close')}>
        <IconClose size={11} />
      </button>
    </div>
  )
}
