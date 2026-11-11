import { useEffect, useState, type JSX } from 'react'
import type { SubtitleSearchStatus } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { useT } from '@renderer/i18n'

const CONSUMERS_URL = 'https://www.opensubtitles.com/en/consumers'

/**
 * Where a user supplies the key that turns subtitle search on.
 *
 * The whole section exists because LiberCast ships no key of its own, and
 * that decision pushes a developer-flow registration onto the user. So the
 * work here is making that bearable: say plainly what the key is for, link
 * straight to the page that issues one, and — above all — let them press a
 * button that answers "is this right?" before they go looking at the player
 * and find nothing.
 */
export function SubtitleSearchSection(): JSX.Element {
  const t = useT()

  const [status, setStatus] = useState<SubtitleSearchStatus | null>(null)
  const [key, setKey] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'key' | 'account' | null>(null)
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null)

  useEffect(() => {
    void invoke('subtitles:searchStatus').then(setStatus)
  }, [])

  const testKey = async (): Promise<void> => {
    setBusy('key')
    setNote(null)
    try {
      await invoke('subtitles:testKey', key.trim() === '' ? null : key.trim())
      setNote({ good: true, text: t('settings.subtitleTestOk') })
    } catch (error) {
      setNote({ good: false, text: messageOf(error) })
    } finally {
      setBusy(null)
    }
  }

  const saveKey = async (): Promise<void> => {
    setBusy('key')
    setNote(null)
    try {
      setStatus(await invoke('subtitles:setKey', key.trim() === '' ? null : key.trim()))
      setKey('')
    } catch (error) {
      setNote({ good: false, text: messageOf(error) })
    } finally {
      setBusy(null)
    }
  }

  const saveAccount = async (): Promise<void> => {
    setBusy('account')
    setNote(null)
    try {
      // Checked before it is stored: a saved sign-in that does not work is a
      // smaller download allowance discovered later, for no stated reason.
      await invoke('subtitles:testAccount', { username: username.trim(), password })
      setStatus(await invoke('subtitles:setAccount', { username: username.trim(), password }))
      setPassword('')
    } catch (error) {
      setNote({ good: false, text: messageOf(error) })
    } finally {
      setBusy(null)
    }
  }

  const signOut = async (): Promise<void> => {
    setStatus(await invoke('subtitles:setAccount', { username: null, password: null }))
    setUsername('')
    setPassword('')
  }

  return (
    <section className="settings__group">
      <h3>{t('settings.subtitleSearch')}</h3>

      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 2px 10px', lineHeight: 1.5 }}>
        {t('settings.subtitleSearchBody')}
      </p>

      {status && !status.configured && (
        <div className="notice" style={{ marginBottom: 10 }}>
          {t('settings.subtitleNotConfigured')}
        </div>
      )}

      <div className="settings__row">
        <div>
          <strong>{t('settings.subtitleKey')}</strong>
          <span>{t('settings.subtitleKeyHelp')}</span>
        </div>
        <a className="btn btn--ghost" href={CONSUMERS_URL} target="_blank" rel="noreferrer">
          {t('settings.subtitleKeyLink')}
        </a>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          type="password"
          value={key}
          aria-label={t('settings.subtitleKey')}
          placeholder={status?.configured ? '••••••••' : t('settings.subtitleKey')}
          onChange={(event) => setKey(event.target.value)}
        />
        <button className="btn" onClick={() => void testKey()} disabled={busy !== null}>
          {t('settings.subtitleTest')}
        </button>
        <button
          className="btn btn--primary"
          onClick={() => void saveKey()}
          disabled={busy !== null || key.trim() === ''}
        >
          {t('settings.subtitleSave')}
        </button>
      </div>

      {note && (
        <p
          style={{
            fontSize: 12,
            margin: '8px 2px 0',
            lineHeight: 1.5,
            color: note.good ? 'var(--success)' : 'var(--danger, #ff5f57)'
          }}
        >
          {note.text}
        </p>
      )}

      <div className="settings__row" style={{ marginTop: 14 }}>
        <div>
          <strong>{t('settings.subtitleAccount')}</strong>
          <span>{t('settings.subtitleAccountBody')}</span>
        </div>
        {status?.signedIn && (
          <button className="btn btn--ghost" onClick={() => void signOut()}>
            {t('settings.subtitleSignOut')}
          </button>
        )}
      </div>

      {status?.signedIn ? (
        <p style={{ fontSize: 12, color: 'var(--success)', margin: '6px 2px 0' }}>
          {t('settings.subtitleSignedIn')}
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            value={username}
            aria-label={t('settings.subtitleUsername')}
            placeholder={t('settings.subtitleUsername')}
            onChange={(event) => setUsername(event.target.value)}
          />
          <input
            className="input"
            style={{ flex: 1 }}
            type="password"
            value={password}
            aria-label={t('settings.subtitlePassword')}
            placeholder={t('settings.subtitlePassword')}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            className="btn btn--primary"
            onClick={() => void saveAccount()}
            disabled={busy !== null || username.trim() === '' || password === ''}
          >
            {t('settings.subtitleSave')}
          </button>
        </div>
      )}
    </section>
  )
}
