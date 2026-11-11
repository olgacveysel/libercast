import { useEffect, useRef, useState, type JSX } from 'react'
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
 *
 * Silent is not the same as unaccountable. For as long as the notice is up,
 * the switch can be refused: the names only matched, they were not identical,
 * and the person watching is the only one who can see that the picture is a
 * different region's feed.
 */
export function SwitchedNotice({
  switched,
  onWrongChannel
}: {
  switched: StreamState['switched']
  /**
   * "That is not my channel."
   *
   * Two providers rarely spell a channel the same way, so a switch is made on
   * names that match rather than names that are identical — and a name that
   * matches can still be another region's feed. This is the correction, and
   * the only moment it can be made: the notice is on screen precisely when
   * the user can see what is actually playing.
   */
  onWrongChannel?: (alternateChannelId: number) => void
}): JSX.Element | null {
  const [shown, setShown] = useState<StreamState['switched']>(null)
  const t = useT()

  /*
   * Keyed on the content rather than the object: a re-render that produces an
   * equal report must not restart the countdown.
   *
   * Every field is in the key, including the two channel ids. They are not
   * displayed, but `onWrongChannel` sends `shown.alternateChannelId` back —
   * so a second failover whose name and labels happen to match the first
   * would otherwise leave the correction pointing at the previous channel.
   *
   * The report itself is read through a ref so the effect does not have to
   * depend on the object identity it is deliberately ignoring.
   */
  const latest = useRef(switched)
  latest.current = switched

  useEffect(() => {
    const report = latest.current
    if (!report) return
    setShown(report)
    const timer = setTimeout(() => setShown(null), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [
    switched?.channelName,
    switched?.from,
    switched?.to,
    switched?.requestedChannelId,
    switched?.alternateChannelId
  ])

  if (!shown) return null

  return (
    <div className="switched" role="status">
      <span>{t('player.switchedSource', { from: shown.from, to: shown.to })}</span>
      {onWrongChannel && (
        <button
          className="switched__wrong"
          onClick={() => {
            onWrongChannel(shown.alternateChannelId)
            setShown(null)
          }}
        >
          {t('player.switchedWrong')}
        </button>
      )}
      <button onClick={() => setShown(null)} aria-label={t('common.close')}>
        <IconClose size={11} />
      </button>
    </div>
  )
}
