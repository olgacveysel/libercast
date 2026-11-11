import { useEffect, useState, type JSX } from 'react'
import type { ExternalSubtitle, SubtitleHit } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { useT } from '@renderer/i18n'
import { useAppStore } from '@renderer/store/useAppStore'

interface Props {
  /** What is playing: the title the service is asked about. */
  query: string
  season?: number
  episode?: number
  onPicked: (subtitle: ExternalSubtitle) => void
  onClose: () => void
}

/**
 * Picking a subtitle out of what OpenSubtitles offers.
 *
 * Searching happens on opening rather than behind a button: the dialog is
 * only ever opened by someone who has already asked to search, and making
 * them ask twice would be asking for the sake of it.
 *
 * The first thing it checks is whether a key is set at all. That is not an
 * error so much as the normal state of this feature until somebody supplies
 * one, and it gets its own message pointing at Settings rather than whatever
 * the service says to an empty key.
 */
export function SubtitleSearchDialog({ query, season, episode, onPicked, onClose }: Props): JSX.Element {
  const t = useT()
  const language = useAppStore((state) => state.settings.language)

  const [hits, setHits] = useState<SubtitleHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsKey, setNeedsKey] = useState(false)
  const [fetching, setFetching] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const status = await invoke('subtitles:searchStatus')
        if (cancelled) return
        if (!status.configured) {
          setNeedsKey(true)
          return
        }

        // The interface language first, English after it: the chance that
        // somebody reading a Turkish interface wants Turkish subtitles is
        // high, and the chance they would accept English is higher still.
        const languages = language === 'en' ? ['eng'] : [THREE_LETTER[language] ?? language, 'eng']

        const found = await invoke('subtitles:search', {
          query,
          languages,
          season,
          episode
        })
        if (!cancelled) setHits(found)
      } catch (e) {
        if (!cancelled) setError(messageOf(e))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [query, season, episode, language])

  const choose = async (hit: SubtitleHit): Promise<void> => {
    setFetching(hit.fileId)
    setError(null)
    try {
      onPicked(await invoke('subtitles:fetch', hit.fileId))
      onClose()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setFetching(null)
    }
  }

  return (
    <div className="dialog__backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog__head">
          <strong>{t('player.searchSubtitles')}</strong>
          <button className="btn btn--ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>

        <div className="dialog__body">
          {needsKey && <p>{t('player.searchSubtitlesNoKey')}</p>}

          {error && <div className="notice notice--error">{error}</div>}

          {!needsKey && !error && hits === null && <p>{t('player.searchSubtitlesSearching')}</p>}

          {hits !== null && hits.length === 0 && <p>{t('player.searchSubtitlesNone')}</p>}

          {hits?.map((hit) => (
            <button
              key={hit.fileId}
              className="plcard"
              style={{ width: '100%', textAlign: 'left', marginBottom: 6 }}
              onClick={() => void choose(hit)}
              disabled={fetching !== null}
            >
              <div className="plcard__text">
                <strong>{hit.title ?? hit.fileName}</strong>
                <span>
                  {[
                    hit.language?.toUpperCase(),
                    t('player.searchSubtitlesDownloads', { count: hit.downloads }),
                    hit.hearingImpaired ? 'SDH' : null
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {fetching === hit.fileId && <span className="spinner" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The service wants ISO 639-2B, the interface is keyed by two-letter codes.
 *
 * Only the languages LiberCast is translated into: a wider table would be
 * guessing at what somebody wants from a setting that does not mean that.
 */
const THREE_LETTER: Record<string, string> = {
  en: 'eng',
  tr: 'tur',
  de: 'ger'
}
