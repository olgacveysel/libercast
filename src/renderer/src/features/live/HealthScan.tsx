import { useEffect, useState, type JSX } from 'react'
import type { ChannelHealth } from '@shared/types'
import { invoke, messageOf, subscribe } from '@renderer/lib/api'
import { useT } from '@renderer/i18n'

interface Props {
  playlistId: number
  onClose: () => void
}

/**
 * Checks every favourite in turn and lists the ones that no longer play.
 *
 * A panel rather than a mark on each row, for now: showing it per row means
 * carrying the result through the catalogue queries, and the first useful
 * version of this is a list you read once and act on.
 */
export function HealthScan({ playlistId, onClose }: Props): JSX.Element {
  const t = useT()
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [results, setResults] = useState<ChannelHealth[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => subscribe('health:progress', setProgress), [])

  useEffect(() => {
    let live = true
    void invoke('health:scanFavorites', playlistId)
      .then((found) => live && setResults(found))
      .catch((e) => live && setError(messageOf(e)))
    return () => {
      live = false
      // Leaving mid-scan stops it: every check is a request to the provider,
      // and a scan nobody is watching is just load on an account that probably
      // allows one connection.
      void invoke('health:cancel').catch(() => {})
    }
  }, [playlistId])

  const failed = results?.filter((r) => !r.ok) ?? []

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('health.title')}>
        <div className="dialog__head">
          <h2>{t('health.title')}</h2>
          <p>{t('health.body')}</p>
        </div>

        <div className="dialog__body" style={{ gap: 10 }}>
          {error && <div className="notice notice--error">{error}</div>}

          {results === null ? (
            <div className="health__progress">
              <span className="spinner" />
              <span>
                {progress
                  ? t('health.checking', {
                      done: progress.done + 1,
                      total: progress.total,
                      name: progress.current
                    })
                  : t('common.loading')}
              </span>
            </div>
          ) : failed.length === 0 ? (
            <div className="notice">{t('health.allWell', { count: results.length })}</div>
          ) : (
            <>
              <div className="notice notice--error">
                {t('health.summary', { failed: failed.length, total: results.length })}
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto', margin: '0 -4px' }}>
                {failed.map((row) => (
                  <div key={row.channelId} className="health__row">
                    <span className="health__name">{row.name}</span>
                    <span className="health__reason">{row.reason ?? t('health.noReason')}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="dialog__foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            {results === null ? t('common.cancel') : t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
