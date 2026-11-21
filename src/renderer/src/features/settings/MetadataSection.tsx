import { useEffect, useState, type JSX } from 'react'
import type { TmdbStatus } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { useT } from '@renderer/i18n'
import { TmdbAttribution } from './TmdbAttribution'

const KEY_URL = 'https://www.themoviedb.org/settings/api'

/**
 * Where a user supplies the key that turns metadata lookup on.
 *
 * LiberCast ships no key of its own — this source is public, so a key inside
 * it is a key anybody can extract, and the account suspended over somebody
 * else's use of it would be the maintainer's. The same decision settled
 * subtitle search, and this section is deliberately the same shape: say what
 * the key is for, link straight to the page that issues one, and let the
 * user press a button that answers "is this right?" before they go looking
 * at a film and find nothing.
 */
export function MetadataSection(): JSX.Element {
  const t = useT()

  const [status, setStatus] = useState<TmdbStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null)

  useEffect(() => {
    void invoke('tmdb:status').then(setStatus)
  }, [])

  const test = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      await invoke('tmdb:testKey', key.trim() === '' ? null : key.trim())
      setNote({ good: true, text: t('settings.metaTestOk') })
    } catch (error) {
      setNote({ good: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      setStatus(await invoke('tmdb:setKey', key.trim() === '' ? null : key.trim()))
      setKey('')
    } catch (error) {
      setNote({ good: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const forget = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      setStatus(await invoke('tmdb:setKey', null))
      setKey('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings__group">
      <h3>{t('settings.metadata')}</h3>

      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 2px 10px', lineHeight: 1.5 }}>
        {t('settings.metadataBody')}
      </p>

      {status && !status.hasKey && (
        <div className="notice" style={{ marginBottom: 10 }}>{t('settings.metaNotConfigured')}</div>
      )}

      <div className="settings__row">
        <div>
          <strong>{t('settings.metaKey')}</strong>
          <span>{t('settings.metaKeyHelp')}</span>
        </div>
        <a className="btn btn--ghost" href={KEY_URL} target="_blank" rel="noreferrer">
          {t('settings.metaKeyLink')}
        </a>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          type="password"
          value={key}
          aria-label={t('settings.metaKey')}
          placeholder={status?.hasKey ? '••••••••' : t('settings.metaKey')}
          onChange={(event) => setKey(event.target.value)}
        />
        <button className="btn" onClick={() => void test()} disabled={busy}>
          {t('settings.metaTest')}
        </button>
        <button
          className="btn btn--primary"
          onClick={() => void save()}
          disabled={busy || key.trim() === ''}
        >
          {t('settings.metaSave')}
        </button>
        {status?.hasKey && (
          <button className="btn btn--ghost" onClick={() => void forget()} disabled={busy}>
            {t('settings.metaForget')}
          </button>
        )}
      </div>

      {note && (
        <div className={`notice ${note.good ? '' : 'notice--error'}`} style={{ marginTop: 8 }}>
          {note.text}
        </div>
      )}

      {/*
        Required by TMDB's terms, and it has to be somewhere a person can
        find — their wording is "within your application's About or Credits
        type section". Logo and sentence both; see TmdbAttribution.
      */}
      <TmdbAttribution />
    </section>
  )
}
