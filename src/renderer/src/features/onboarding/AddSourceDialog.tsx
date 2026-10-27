import { useState, type JSX } from 'react'
import type { PlaylistDraft, SourceKind, XtreamAccountInfo } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { formatDate } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'
import { useT } from '@renderer/i18n'

interface Props {
  onClose: () => void
  onCreated: (playlistId: number) => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; account: XtreamAccountInfo | null }
  | { kind: 'error'; message: string }

export function AddSourceDialog({ onClose, onCreated }: Props): JSX.Element {
  const refreshPlaylists = useAppStore((s) => s.refreshPlaylists)
  const t = useT()

  const [kind, setKind] = useState<SourceKind>('xtream')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)

  const draft = (): PlaylistDraft => ({
    name: name.trim() || (kind === 'xtream' ? hostOf(url) : 'My playlist'),
    kind,
    url: url.trim(),
    filePath,
    username: username.trim() || null,
    password: password || null
  })

  const canSubmit =
    kind === 'xtream'
      ? url.trim() !== '' && username.trim() !== '' && password !== ''
      : url.trim() !== '' || filePath !== null

  const test = async (): Promise<void> => {
    setStatus({ kind: 'testing' })
    try {
      const account = await invoke('playlists:test', draft())
      setStatus({ kind: 'ok', account })
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) })
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setStatus({ kind: 'idle' })
    try {
      const created = await invoke('playlists:create', draft())
      await refreshPlaylists()
      onCreated(created.id)
    } catch (error) {
      setStatus({ kind: 'error', message: messageOf(error) })
      setSaving(false)
    }
  }

  const browse = async (): Promise<void> => {
    const picked = await invoke('dialog:pickM3uFile')
    if (picked) {
      setFilePath(picked)
      setUrl('')
      if (!name) setName(picked.split(/[\\/]/).pop()?.replace(/\.m3u8?$/i, '') ?? 'Playlist')
    }
  }

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('source.add')}>
        <div className="dialog__head">
          <h2>{t('source.add')}</h2>
          <p>{t('source.addBody')}</p>
        </div>

        <div className="dialog__body">
          <div className="segmented" style={{ gridAutoFlow: 'column', gridAutoColumns: '1fr' }}>
            <button aria-pressed={kind === 'xtream'} onClick={() => setKind('xtream')}>
              Xtream Codes
            </button>
            <button aria-pressed={kind === 'm3u'} onClick={() => setKind('m3u')}>
              {t('source.m3u')}
            </button>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="src-name">
              {t('source.name')}
            </label>
            <input
              id="src-name"
              className="input"
              placeholder={kind === 'xtream' ? t('source.nameProvider') : t('source.namePlaylist')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {kind === 'xtream' ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor="src-url">
                  {t('source.serverUrl')}
                </label>
                <input
                  id="src-url"
                  className="input"
                  placeholder="http://example.com:8080"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  spellCheck={false}
                />
                <span className="field__hint">{t('source.serverUrlHint')}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label className="field__label" htmlFor="src-user">
                    {t('settings.username')}
                  </label>
                  <input
                    id="src-user"
                    className="input"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="src-pass">
                    {t('source.password')}
                  </label>
                  <input
                    id="src-pass"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>

              <span className="field__hint">{t('source.passwordHint')}</span>
            </>
          ) : (
            <>
              <div className="field">
                <label className="field__label" htmlFor="src-m3u">
                  {t('source.playlistUrl')}
                </label>
                <input
                  id="src-m3u"
                  className="input"
                  placeholder="http://example.com/get.php?username=…"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value)
                    setFilePath(null)
                  }}
                  spellCheck={false}
                />
              </div>

              <div className="field">
                <span className="field__label">{t('source.orLocalFile')}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn" onClick={() => void browse()}>
                    {t('source.browse')}
                  </button>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-dim)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {filePath ?? t('source.noFile')}
                  </span>
                </div>
              </div>
            </>
          )}

          {status.kind === 'error' && <div className="notice notice--error">{status.message}</div>}

          {status.kind === 'ok' && (
            <div className="notice notice--success">
              {status.account ? (
                <>
                  {t('source.connectedAs', {
                    username: status.account.username,
                    status: status.account.status,
                    active: status.account.activeConnections,
                    max: status.account.maxConnections
                  })}
                  {status.account.expiresAt
                    ? t('source.expiresOn', { date: formatDate(status.account.expiresAt) })
                    : t('source.noExpiry')}
                </>
              ) : (
                t('source.playlistOk')
              )}
            </div>
          )}
        </div>

        <div className="dialog__foot">
          <button className="btn" onClick={() => void test()} disabled={!canSubmit || status.kind === 'testing'}>
            {status.kind === 'testing' ? <span className="spinner" /> : null}
            {t('source.test')}
          </button>
          <div className="spacer" />
          <button className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn--primary" onClick={() => void save()} disabled={!canSubmit || saving}>
            {saving ? <span className="spinner" /> : null}
            {t('source.addButton')}
          </button>
        </div>
      </div>
    </div>
  )
}

function hostOf(value: string): string {
  try {
    return new URL(value.startsWith('http') ? value : `http://${value}`).hostname
  } catch {
    return 'My provider'
  }
}
