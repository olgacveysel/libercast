import type { JSX } from 'react'
import type { AlternateChoice } from '@shared/types'
import { useT } from '@renderer/i18n'

/**
 * "Is this your channel?"
 *
 * Shown when the requested source failed and another provider has a channel
 * whose name is close but not identical. The application deliberately refuses
 * to decide this one: the difference between "Alto Sports 2 HD" and "Alto
 * Sports 2 Turkey" is one word in both cases, and only the person watching
 * knows which word changes the channel.
 *
 * So the names are printed as the providers wrote them, unshortened and
 * untouched — the difference is the entire content of the question.
 */
export function AlternatePrompt({
  choice,
  onPlay,
  onDismiss,
  onNever
}: {
  choice: AlternateChoice
  onPlay: (channelId: number) => void
  onDismiss: () => void
  onNever: () => void
}): JSX.Element {
  const t = useT()

  return (
    <div className="altprompt" role="dialog" aria-label={t('player.alternateTitle', { channel: choice.channelName })}>
      <div className="altprompt__card">
        <strong className="altprompt__title">
          {t('player.alternateTitle', { channel: choice.channelName })}
        </strong>
        <p className="altprompt__reason">{choice.reason}</p>
        <p className="altprompt__body">{t('player.alternateBody')}</p>

        <ul className="altprompt__list">
          {choice.offers.map((offer) => (
            <li key={offer.channelId} className="altprompt__offer">
              <div className="altprompt__names">
                <span className="altprompt__name">{offer.channelName}</span>
                <span className="altprompt__source">
                  {t('player.alternateOn', { source: offer.sourceName })}
                </span>
              </div>
              <button className="btn btn--primary" onClick={() => onPlay(offer.channelId)}>
                {t('player.alternatePlay')}
              </button>
            </li>
          ))}
        </ul>

        <div className="altprompt__actions">
          <button className="btn btn--ghost" onClick={onDismiss}>
            {t('player.alternateNone')}
          </button>
          <button className="btn btn--ghost" onClick={onNever}>
            {t('player.alternateNever')}
          </button>
        </div>
      </div>
    </div>
  )
}
