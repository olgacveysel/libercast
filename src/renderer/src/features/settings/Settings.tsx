import { useEffect, useState, type JSX } from 'react'
import type { AppSettings, AutoRefreshReport } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { formatRelative } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'
import { IconKeyboard, IconRefresh, IconTrash } from '@renderer/ui/Icon'
import { SHORTCUTS } from '@renderer/features/player/useHotkeys'
import { LANGUAGES, useT } from '@renderer/i18n'
import { SubtitleAppearance } from './SubtitleAppearance'
import { APP_NAME } from '@shared/app'
import { AccountPanel } from './AccountPanel'
import { ParentalSection } from './ParentalSection'
import { BackupSection } from './BackupSection'

// Teal first: it is the mark's own colour, and the default.
const ACCENTS = ['#22b58f', '#4f8cff', '#8f6bff', '#35c46b', '#f5a623', '#ff5f57']

interface Props {
  onAddSource: () => void
}

export function Settings({ onAddSource }: Props): JSX.Element {
  // Read from the packaged app rather than duplicated in the UI, so a release
  // cannot ship a version number that disagrees with itself.
  const [version, setVersion] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void invoke('app:version').then(setVersion).catch(() => setVersion(null))
  }, [])

  const { settings, updateSettings, playlists, refreshPlaylists, capabilities } = useAppStore()
  const t = useT()
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [logMessage, setLogMessage] = useState<string | null>(null)

  const refreshNow = async (): Promise<void> => {
    setRefreshing(true)
    setError(null)
    try {
      await invoke('sources:refreshNow')
      await refreshPlaylists()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setRefreshing(false)
    }
  }

  const sync = async (id: number): Promise<void> => {
    setBusy(id)
    setError(null)
    try {
      await invoke('playlists:sync', id)
      await refreshPlaylists()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: number, name: string): Promise<void> => {
    // Deliberately not a native confirm dialog — those block the renderer.
    if (!window.confirm(`Remove "${name}"? Favorites and history for it are deleted too.`)) return
    setBusy(id)
    try {
      await invoke('playlists:remove', id)
      await refreshPlaylists()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }

  const saveSource = async (id: number, patch: SourcePatch): Promise<void> => {
    setBusy(id)
    setError(null)
    try {
      await invoke('playlists:update', {
        id,
        patch: {
          epgUrl: patch.epgUrl.trim() || null,
          epgOffsetMinutes: patch.epgOffsetMinutes,
          // Empty means "use the default", which the main process supplies —
          // storing an empty string would send a blank User-Agent instead.
          userAgent: patch.userAgent.trim() || null,
          referrer: patch.referrer.trim() || null
        }
      })
      await refreshPlaylists()
      setEditing(null)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }

  const pickFolder = async (key: keyof AppSettings): Promise<void> => {
    const folder = await invoke('dialog:pickFolder')
    if (folder) void updateSettings({ [key]: folder } as Partial<AppSettings>)
  }

  return (
    <>
      <div className="toolbar">
        <h1 className="toolbar__title">{t('settings.title')}</h1>
      </div>

      <div className="settings">
        {error && (
          <div className="notice notice--error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <section className="settings__group">
          <h3>{t('settings.sources')}</h3>

          {playlists.map((playlist) => (
            <div key={playlist.id}>
              <div className="plcard" style={{ marginBottom: editing === playlist.id ? 0 : 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: playlist.lastSyncedAt ? 'var(--success)' : 'var(--text-dim)'
                  }}
                />
                <div className="plcard__text">
                  <strong>{playlist.name}</strong>
                  <span>
                    {playlist.kind === 'xtream' ? 'Xtream Codes' : 'M3U'} · synced{' '}
                    {formatRelative(playlist.lastSyncedAt)}
                  </span>
                </div>
                <button
                  className="btn btn--ghost"
                  onClick={() => setEditing(editing === playlist.id ? null : playlist.id)}
                >
                  {editing === playlist.id ? t('common.done') : t('common.edit')}
                </button>
                <button className="btn" onClick={() => void sync(playlist.id)} disabled={busy === playlist.id}>
                  {busy === playlist.id ? <span className="spinner" /> : <IconRefresh size={15} />}
                  {t('common.sync')}
                </button>
                <button
                  className="btn btn--danger"
                  onClick={() => void remove(playlist.id, playlist.name)}
                  disabled={busy === playlist.id}
                  aria-label={`Remove ${playlist.name}`}
                >
                  <IconTrash size={15} />
                </button>
              </div>

              {editing === playlist.id && <AccountPanel playlist={playlist} />}

              {editing === playlist.id && (
                <SourceSettings
                  key={`${playlist.id}:${playlist.epgUrl}:${playlist.userAgent}`}
                  epgUrl={playlist.epgUrl ?? ''}
                  offset={playlist.epgOffsetMinutes}
                  userAgent={playlist.userAgent ?? ''}
                  referrer={playlist.referrer ?? ''}
                  isXtream={playlist.kind === 'xtream'}
                  busy={busy === playlist.id}
                  onSave={(patch) => void saveSource(playlist.id, patch)}
                />
              )}
            </div>
          ))}

          <button className="btn btn--primary" onClick={onAddSource} style={{ marginTop: 6 }}>
            {t('nav.addSource')}
          </button>
        </section>

        <section className="settings__group">
          <h3>{t('settings.connections')}</h3>

          <div className="settings__row">
            <div>
              <strong>Spend as few connections as possible</strong>
              <span>
                Playing a channel normally takes two connections in quick succession — one to
                identify the stream, one to play it. If your account allows only one, the second is
                refused and the channel opens only sometimes. Turn this on and a live channel that
                has not been played before is started on assumption instead.
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.singleConnection}
              onChange={(event) => void updateSettings({ singleConnection: event.target.checked })}
            />
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '2px 2px 0', lineHeight: 1.5 }}>
            Either way, what a stream turned out to be is remembered, so playing anything a second
            time costs a single connection. The audio and subtitle menus for a live channel stay
            empty until it has been played once.
          </p>
        </section>

        <section className="settings__group">
          <h3>{t('settings.autoRefresh')}</h3>

          <div className="settings__row">
            <div>
              <strong>Refresh sources every</strong>
              <span>
                Off by default. A refresh talks to your provider, and it is skipped while something
                is playing so it can never take the connection a stream is using.
              </span>
            </div>
            <select
              className="input"
              style={{ width: 130 }}
              value={settings.autoRefreshHours}
              onChange={(event) => void updateSettings({ autoRefreshHours: Number(event.target.value) })}
            >
              {[0, 6, 12, 24, 48, 168].map((hours) => (
                <option key={hours} value={hours}>
                  {hours === 0 ? 'Never' : hours === 168 ? 'Week' : `${hours} hours`}
                </option>
              ))}
            </select>
          </div>

          {settings.autoRefreshHours > 0 && (
            <div className="settings__row">
              <div>
                <strong>Include the guide</strong>
                <span>Downloads the EPG in the same pass.</span>
              </div>
              <input
                type="checkbox"
                checked={settings.autoRefreshEpg}
                onChange={(event) => void updateSettings({ autoRefreshEpg: event.target.checked })}
              />
            </div>
          )}

          <div className="settings__row" style={{ alignItems: 'flex-start' }}>
            <div>
              <strong>Last automatic refresh</strong>
              <span>{describeRefresh(settings.lastAutoRefresh)}</span>
            </div>
            <button className="btn" onClick={() => void refreshNow()} disabled={refreshing}>
              {refreshing ? <span className="spinner" /> : <IconRefresh size={15} />}
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
        </section>

        <section className="settings__group">
          <h3>{t('settings.appearance')}</h3>

          {/* First in this section on purpose: someone who has landed in a
              language they cannot read needs to find this without reading
              anything else, and each option is written in its own language. */}
          <div className="settings__row">
            <div>
              <strong>{t('settings.language')}</strong>
              <span>{t('settings.languageBody')}</span>
            </div>
            <div className="segmented">
              {LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  aria-pressed={settings.language === language.code}
                  onClick={() => void updateSettings({ language: language.code })}
                  lang={language.code}
                >
                  {language.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings__row">
            <div>
              <strong>{t('settings.theme')}</strong>
              <span>{t('settings.themeBody')}</span>
            </div>
            <div className="segmented">
              {(['dark', 'light', 'system'] as const).map((theme) => (
                <button
                  key={theme}
                  aria-pressed={settings.theme === theme}
                  onClick={() => void updateSettings({ theme })}
                >
                  {theme === 'dark'
                    ? t('settings.themeDark')
                    : theme === 'light'
                      ? t('settings.themeLight')
                      : t('settings.themeSystem')}
                </button>
              ))}
            </div>
          </div>

          <div className="settings__row">
            <div>
              <strong>Interface size</strong>
              <span>Scales everything. Useful on a big screen watched from the sofa.</span>
            </div>
            <div className="segmented">
              {([
                ['Small', 0.9],
                ['Default', 1],
                ['Large', 1.15],
                ['Larger', 1.3]
              ] as const).map(([label, scale]) => (
                <button
                  key={label}
                  aria-pressed={settings.uiScale === scale}
                  onClick={() => void updateSettings({ uiScale: scale })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings__row">
            <div>
              <strong>Accent colour</strong>
              <span>Used for selection, focus rings and progress.</span>
            </div>
            <div className="swatches">
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  className="swatch"
                  style={{ background: color }}
                  aria-pressed={settings.accentColor === color}
                  aria-label={`Accent ${color}`}
                  onClick={() => void updateSettings({ accentColor: color })}
                />
              ))}
            </div>
          </div>
        </section>

        <SubtitleAppearance />

        <section className="settings__group">
          <h3>Playback</h3>

          <div className="settings__row">
            <div>
              <strong>Hardware acceleration</strong>
              <span>Uses the GPU to decode video. Turn off only if playback tears or crashes.</span>
            </div>
            <input
              type="checkbox"
              checked={settings.hardwareAcceleration}
              onChange={(event) => void updateSettings({ hardwareAcceleration: event.target.checked })}
            />
          </div>

          <div className="settings__row">
            <div>
              <strong>Show stream info</strong>
              <span>
                Resolution, measured frame rate, dropped frames and codec, over the picture. Hidden in
                fullscreen. Press I to toggle while watching.
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.showStreamStats}
              onChange={(event) => void updateSettings({ showStreamStats: event.target.checked })}
            />
          </div>

          <div className="settings__row">
            <div>
              <strong>Resume last channel on start</strong>
              <span>Opens the channel you were last watching when the app launches.</span>
            </div>
            <input
              type="checkbox"
              checked={settings.resumeLastChannel}
              onChange={(event) => void updateSettings({ resumeLastChannel: event.target.checked })}
            />
          </div>
        </section>

        <section className="settings__group">
          <h3>Languages</h3>

          <div className="settings__row">
            <div>
              <strong>Preferred audio</strong>
              <span>
                Picked automatically when a title offers more than one language. Drag-free: click to toggle,
                order follows the list below.
              </span>
            </div>
            <LanguagePicker
              selected={settings.preferredAudioLanguages}
              onChange={(codes) => void updateSettings({ preferredAudioLanguages: codes })}
            />
          </div>

          <div className="settings__row">
            <div>
              <strong>Preferred subtitles</strong>
              <span>
                Turned on automatically when a matching track exists. Leave empty to keep subtitles off
                unless you pick them.
              </span>
            </div>
            <LanguagePicker
              selected={settings.preferredSubtitleLanguages}
              onChange={(codes) => void updateSettings({ preferredSubtitleLanguages: codes })}
            />
          </div>
        </section>

        <section className="settings__group">
          <h3>Media engine</h3>

          <div className="settings__row">
            <div>
              <strong>ffmpeg</strong>
              <span>
                {capabilities?.ffmpeg
                  ? `Working — using the ${capabilities.ffmpegSource} copy.`
                  : 'Not found. MPEG-TS channels and recording are unavailable without it.'}
              </span>
            </div>
            <span className={`badge ${capabilities?.ffmpeg ? '' : 'badge--live'}`}>
              {capabilities?.ffmpeg ? 'Ready' : 'Missing'}
            </span>
          </div>

          <div className="settings__row">
            <div>
              <strong>Custom ffmpeg folder</strong>
              <span>
                {settings.ffmpegPath ??
                  'Not set. Point this at a folder containing ffmpeg and ffprobe if the bundled copy fails.'}
              </span>
            </div>
            <button className="btn" onClick={() => void pickFolder('ffmpegPath')}>
              {t('settings.choose')}
            </button>
            {settings.ffmpegPath && (
              <button className="btn btn--ghost" onClick={() => void updateSettings({ ffmpegPath: null })}>
                Clear
              </button>
            )}
          </div>
        </section>

        <section className="settings__group">
          <h3>Downloads</h3>

          <div className="settings__row">
            <div>
              <strong>Simultaneous downloads</strong>
              <span>
                Each download holds a connection to your provider. Most accounts allow very few, so more
                than one can stop playback working.
              </span>
            </div>
            <select
              className="input"
              style={{ width: 80 }}
              value={settings.maxConcurrentDownloads}
              onChange={(event) =>
                void updateSettings({ maxConcurrentDownloads: Number(event.target.value) })
              }
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="settings__group">
          <h3>Parental controls</h3>
          <ParentalSection />
        </section>

        <section className="settings__group">
          <h3>Backup</h3>
          <BackupSection />
        </section>

        <section className="settings__group">
          <h3>{t('settings.keyboard')}</h3>

          <div className="keys">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="keys__row">
                <kbd>{shortcut.keys}</kbd>
                <span>{shortcut.action}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '8px 0 0', display: 'flex', gap: 6, alignItems: 'center' }}>
            <IconKeyboard size={14} />
            Shortcuts are ignored while typing in a field.
          </p>
        </section>

        <section className="settings__group">
          <h3>{t('settings.folders')}</h3>

          <div className="settings__row">
            <div>
              <strong>{t('settings.recordingsFolder')}</strong>
              <span>{settings.recordingsPath ?? t('settings.notSet')}</span>
            </div>
            <button className="btn" onClick={() => void pickFolder('recordingsPath')}>
              {t('settings.choose')}
            </button>
          </div>

          <div className="settings__row">
            <div>
              <strong>{t('settings.downloadsFolder')}</strong>
              <span>{settings.downloadsPath ?? t('settings.notSet')}</span>
            </div>
            <button className="btn" onClick={() => void pickFolder('downloadsPath')}>
              {t('settings.choose')}
            </button>
          </div>
        </section>

        <section className="settings__group">
          <h3>{t('settings.about')}</h3>

          <div className="settings__row">
            <div>
              <strong>{APP_NAME}</strong>
              <span>
                {t('settings.version', { version: version ?? '…' })} · {t('home.welcomeBody')}
              </span>
            </div>
          </div>

          {/*
            The log matters more in a packaged build than in development: there
            is no console window, so this is the only way for someone testing
            the application to get at what it recorded. Credentials are
            redacted before anything is written, so the file is safe to send.
          */}
          <div className="settings__row">
            <div>
              <strong>{t('settings.logs')}</strong>
              <span>{logMessage ?? t('settings.logsBody')}</span>
            </div>
            <button
              className="btn"
              onClick={() => {
                void invoke('app:showLogs')
                  .then((path) => setLogMessage(path === null ? t('settings.logsNone') : null))
                  .catch((error) => setLogMessage(messageOf(error)))
              }}
            >
              {t('settings.showLogs')}
            </button>
          </div>
        </section>
      </div>
    </>
  )
}

export interface SourcePatch {
  epgUrl: string
  epgOffsetMinutes: number
  userAgent: string
  referrer: string
}

interface SourceSettingsProps {
  epgUrl: string
  /** Minutes, as stored. Named apart from the patch field it becomes. */
  offset: number
  userAgent: string
  referrer: string
  isXtream: boolean
  busy: boolean
  onSave: (patch: SourcePatch) => void
}

/**
 * Per-source settings.
 *
 * The guide offset exists because a large share of providers publish XMLTV
 * stamps in the wrong timezone, which shows up as a guide that is correct but
 * shifted by a whole number of hours. The User-Agent is here because panels
 * routinely refuse ffmpeg's own `Lavf/…` and serve the identical URL happily to
 * something that looks like a set-top box — the app sends a VLC string by
 * default, and this is the escape hatch when a provider wants a different one.
 */
function SourceSettings({
  epgUrl,
  offset,
  userAgent,
  referrer,
  isXtream,
  busy,
  onSave
}: SourceSettingsProps): JSX.Element {
  const [url, setUrl] = useState(epgUrl)
  const [minutes, setMinutes] = useState(offset)
  const [agent, setAgent] = useState(userAgent)
  const [refer, setRefer] = useState(referrer)

  return (
    <div
      className="plcard"
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, borderTop: 'none', marginBottom: 8 }}
    >
      <div className="field">
        <label className="field__label">XMLTV URL</label>
        <input
          className="input"
          placeholder={isXtream ? "Leave empty to use the provider's own guide" : 'http://example.com/xmltv.xml.gz'}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          spellCheck={false}
        />
        <span className="field__hint">Plain XML or gzip. Overrides the provider guide when set.</span>
      </div>

      <div className="field">
        <label className="field__label">Time offset (minutes)</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            style={{ width: 110 }}
            type="number"
            step={30}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value) || 0)}
          />
          <span className="field__hint" style={{ flex: 1 }}>
            Shifts every programme. Use −60 or +60 when the guide is out by exactly an hour.
          </span>
        </div>
      </div>

      <div className="field">
        <label className="field__label">User-Agent</label>
        <input
          className="input"
          placeholder="VLC/3.0.20 LibVLC/3.0.20 (default)"
          value={agent}
          onChange={(event) => setAgent(event.target.value)}
          spellCheck={false}
        />
        <span className="field__hint">
          Sent with every request to this provider. Leave empty unless streams fail while the same
          links work in another player.
        </span>
      </div>

      <div className="field">
        <label className="field__label">Referrer</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Only needed if your provider asks for one"
            value={refer}
            onChange={(event) => setRefer(event.target.value)}
            spellCheck={false}
          />
          <button
            className="btn btn--primary"
            onClick={() =>
              onSave({ epgUrl: url, epgOffsetMinutes: minutes, userAgent: agent, referrer: refer })
            }
            disabled={busy}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * A one-line account of the last unattended refresh.
 *
 * The point is to make a silent background job auditable: if it has been
 * failing for a week, this is where that becomes visible.
 */
function describeRefresh(report: AutoRefreshReport | null): string {
  if (!report) return 'Has not run yet.'

  const failed = report.sources.filter((source) => source.error !== null)
  const added = report.sources.reduce((sum, source) => sum + (source.added ?? 0), 0)
  const removed = report.sources.reduce((sum, source) => sum + (source.removed ?? 0), 0)

  const when = formatRelative(report.at)

  if (failed.length === report.sources.length && failed.length > 0) {
    return `${when} — failed: ${failed[0]!.error}`
  }

  const parts = [`${when}`]
  parts.push(added === 0 && removed === 0 ? 'nothing changed' : `${added} added, ${removed} removed`)
  if (report.programmes !== null) parts.push(`${report.programmes.toLocaleString()} programmes`)
  if (report.epgError) parts.push(`guide failed: ${report.epgError}`)
  if (failed.length > 0) parts.push(`${failed.length} source(s) failed`)

  return parts.join(' · ')
}

/** Codes offered in Settings. The player understands far more than these. */
const LANGUAGE_CHOICES: { code: string; name: string }[] = [
  { code: 'eng', name: 'English' },
  { code: 'ger', name: 'German' },
  { code: 'tur', name: 'Turkish' },
  { code: 'fre', name: 'French' },
  { code: 'spa', name: 'Spanish' },
  { code: 'ita', name: 'Italian' },
  { code: 'ara', name: 'Arabic' },
  { code: 'rus', name: 'Russian' },
  { code: 'dut', name: 'Dutch' },
  { code: 'por', name: 'Portuguese' }
]

interface LanguagePickerProps {
  selected: string[]
  onChange: (codes: string[]) => void
}

/**
 * Order matters — the first match wins when a title carries several of the
 * chosen languages — so a click appends rather than inserting, and the chosen
 * ones are listed in priority order with their rank shown.
 */
function LanguagePicker({ selected, onChange }: LanguagePickerProps): JSX.Element {
  const toggle = (code: string): void => {
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code])
  }

  return (
    <div className="langpicker">
      {LANGUAGE_CHOICES.map((choice) => {
        const rank = selected.indexOf(choice.code)
        return (
          <button
            key={choice.code}
            className={`langchip ${rank >= 0 ? 'langchip--on' : ''}`}
            aria-pressed={rank >= 0}
            onClick={() => toggle(choice.code)}
          >
            {rank >= 0 && <span className="langchip__rank">{rank + 1}</span>}
            {choice.name}
          </button>
        )
      })}
    </div>
  )
}
