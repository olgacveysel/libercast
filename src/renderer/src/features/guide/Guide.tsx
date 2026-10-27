import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  Category,
  EpgProgram,
  EpgReminder,
  EpgState,
  GuideWindow,
  MediaCapabilities
} from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { formatRelative, formatTime } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'
import { Empty } from '@renderer/ui/Empty'
import { IconBell, IconRecord, IconRefresh } from '@renderer/ui/Icon'
import { useT } from '@renderer/i18n'
import { GuideMatching } from './GuideMatching'

interface Props {
  onAddSource: () => void
  capabilities: MediaCapabilities | null
}

/** Horizontal scale. 5px per minute puts a 30-minute slot at a readable 150px. */
const PX_PER_MIN = 5
const SLOT_MINUTES = 30
const CHANNEL_COL_WIDTH = 210
const ROW_HEIGHT = 46

/** How much of the schedule one screenful of the grid covers. */
const WINDOW_HOURS = 4

/** Rows fetched per page. The grid is not virtualized vertically. */
const PAGE_SIZE = 80

function floorToSlot(timestamp: number): number {
  const slot = SLOT_MINUTES * 60_000
  return Math.floor(timestamp / slot) * slot
}

export function Guide({ onAddSource, capabilities }: Props): JSX.Element {
  const { activePlaylistId, playlists, setActiveChannel, setRoute } = useAppStore()
  const t = useT()

  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [start, setStart] = useState(() => floorToSlot(Date.now()) - SLOT_MINUTES * 60_000)
  const [guide, setGuide] = useState<GuideWindow | null>(null)
  const [state, setState] = useState<EpgState | null>(null)
  const [selected, setSelected] = useState<{ programme: EpgProgram; channelId: number } | null>(null)
  const [scheduleNote, setScheduleNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  /** The reminder on the programme in the dialog, when there is one. */
  const [reminder, setReminder] = useState<EpgReminder | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [matching, setMatching] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selected) {
      setReminder(null)
      return
    }
    void invoke('reminders:find', {
      channelId: selected.channelId,
      title: selected.programme.title,
      startsAt: selected.programme.startsAt
    })
      .then(setReminder)
      .catch(() => setReminder(null))
  }, [selected])

  const playlist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId]
  )

  const end = start + WINDOW_HOURS * 3_600_000
  const trackWidth = ((end - start) / 60_000) * PX_PER_MIN

  // The now marker only needs to move once a minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setCategoryId(null)
    setPage(0)
    if (activePlaylistId == null) return
    void Promise.all([
      invoke('categories:list', { playlistId: activePlaylistId, kind: 'live' }),
      invoke('epg:state', activePlaylistId)
    ])
      .then(([cats, epgState]) => {
        setCategories(cats)
        setState(epgState)
      })
      .catch((e) => setError(messageOf(e)))
  }, [activePlaylistId])

  const load = useCallback(async () => {
    if (activePlaylistId == null) return
    setLoading(true)
    setError(null)
    try {
      const window = await invoke('epg:guide', {
        query: {
          playlistId: activePlaylistId,
          kind: 'live',
          categoryId,
          sort: 'number',
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE
        },
        startsAt: start,
        endsAt: end
      })
      setGuide(window)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setLoading(false)
    }
  }, [activePlaylistId, categoryId, page, start, end])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async (): Promise<void> => {
    if (activePlaylistId == null) return
    setRefreshing(true)
    setError(null)
    try {
      const result = await invoke('epg:refresh', activePlaylistId)
      setState(await invoke('epg:state', activePlaylistId))
      if (result.programmes === 0) {
        setError(t('guide.noProgrammes'))
      } else if (result.matchedChannels === 0) {
        setError(t('guide.noneMatched', { count: result.programmes.toLocaleString() }))
      }
      await load()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setRefreshing(false)
    }
  }

  const jumpToNow = (): void => {
    setStart(floorToSlot(Date.now()) - SLOT_MINUTES * 60_000)
    scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' })
  }

  const ticks = useMemo(() => {
    const result: number[] = []
    for (let t = start; t < end; t += SLOT_MINUTES * 60_000) result.push(t)
    return result
  }, [start, end])

  if (!playlist) {
    return (
      <Empty
        title={t('mv.noSource')}
        description={t('guide.noSourceBody')}
        action={
          <button className="btn btn--primary" onClick={onAddSource}>
            {t('nav.addSource')}
          </button>
        }
      />
    )
  }

  const nowOffset = ((now - start) / 60_000) * PX_PER_MIN
  const nowVisible = now >= start && now <= end

  // The button's name is emphasised inside the sentence, so the sentence is
  // split at its placeholder rather than broken into two keys: a translator
  // keeps the whole thing and can put the name wherever their grammar wants it.
  const [noDataBefore, noDataAfter] = t('guide.noDataYet').split('{action}')

  return (
    <>
      <div className="toolbar">
        <h1 className="toolbar__title">{t('guide.title')}</h1>

        <select
          className="input"
          style={{ width: 200 }}
          value={categoryId ?? ''}
          onChange={(event) => {
            setCategoryId(event.target.value === '' ? null : Number(event.target.value))
            setPage(0)
          }}
        >
          <option value="">{t('live.allChannels')}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

        <div className="segmented">
          <button onClick={() => setStart(start - 2 * 3_600_000)}>−2h</button>
          <button onClick={jumpToNow}>{t('guide.now')}</button>
          <button onClick={() => setStart(start + 2 * 3_600_000)}>+2h</button>
        </div>

        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {new Date(start).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })}
        </span>

        <div className="spacer" />

        {state && (
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
            {t('guide.matchedSummary', {
              count: state.matchedChannels,
              when: formatRelative(state.refreshedAt)
            })}
          </span>
        )}

        <button className="btn" onClick={() => setMatching(true)} disabled={!state}>
          {t('guide.fixMatching')}
        </button>

        <button className="btn" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? <span className="spinner" /> : <IconRefresh size={15} />}
          {refreshing ? t('guide.downloading') : t('guide.refreshEpg')}
        </button>
      </div>

      {error && (
        <div className="notice notice--error" style={{ margin: '10px 14px 0' }}>
          {error}
        </div>
      )}

      {!state && !refreshing && (
        <div className="notice" style={{ margin: '10px 14px 0', background: 'var(--bg-raised)' }}>
          {noDataBefore}
          <strong>{t('guide.refreshEpg')}</strong>
          {noDataAfter}
        </div>
      )}

      {state && state.matchedChannels === 0 && (
        <div className="notice notice--error" style={{ margin: '10px 14px 0' }}>
          {t('guide.downloadedNoneAttached', { count: state.programmeCount.toLocaleString() })}{' '}
          <button className="btn btn--ghost" onClick={() => setMatching(true)}>
            {t('guide.fixMatching')}
          </button>
        </div>
      )}

      <div className="guide">
        <div
          className="guide__scroll"
          ref={scrollRef}
          style={
            {
              '--guide-chan-w': `${CHANNEL_COL_WIDTH}px`,
              '--guide-row-h': `${ROW_HEIGHT}px`
            } as React.CSSProperties
          }
        >
          <div className="guide__inner" style={{ width: CHANNEL_COL_WIDTH + trackWidth }}>
            <div className="guide__ruler">
              <div className="guide__rulercorner" />
              <div className="guide__ticks" style={{ width: trackWidth }}>
                {ticks.map((tick) => (
                  <div
                    key={tick}
                    className="guide__tick"
                    style={{ left: ((tick - start) / 60_000) * PX_PER_MIN, width: SLOT_MINUTES * PX_PER_MIN }}
                  >
                    {formatTime(tick)}
                  </div>
                ))}
              </div>
            </div>

            {nowVisible && (
              <div className="guide__now" style={{ left: CHANNEL_COL_WIDTH + nowOffset }} />
            )}

            {loading && !guide ? (
              <div style={{ padding: 20, color: 'var(--text-dim)' }}>{t('guide.loading')}</div>
            ) : (
              guide?.rows.map((row) => (
                <div key={row.channel.id} className="guide__row">
                  <button
                    className="guide__chan"
                    onClick={() => {
                      setActiveChannel({
                        ...row.channel,
                        favorite: false,
                        lastWatchedAt: null,
                        now: null,
                        next: null,
                        health: null,
                        sources: 1
                      })
                      setRoute('live')
                    }}
                    title={t('guide.watchChannel', { name: row.channel.name })}
                  >
                    {row.channel.logoUrl && <img src={row.channel.logoUrl} alt="" loading="lazy" />}
                    <span>{row.channel.name}</span>
                  </button>

                  <div className="guide__track" style={{ width: trackWidth }}>
                    {row.programmes.length === 0 ? (
                      <div className="guide__gap">{t('guide.noData')}</div>
                    ) : (
                      row.programmes.map((programme) => {
                        const left = Math.max(0, ((programme.startsAt - start) / 60_000) * PX_PER_MIN)
                        const right = Math.min(
                          trackWidth,
                          ((programme.endsAt - start) / 60_000) * PX_PER_MIN
                        )
                        const width = Math.max(2, right - left)
                        const live = now >= programme.startsAt && now < programme.endsAt

                        return (
                          <button
                            key={programme.id}
                            className={`guide__prog ${live ? 'guide__prog--now' : ''}`}
                            style={{ left, width }}
                            onClick={() => {
                              setSelected({ programme, channelId: row.channel.id })
                              setScheduleNote(null)
                            }}
                            title={programme.title}
                          >
                            <strong>{programme.title}</strong>
                            {width > 90 && (
                              <span>
                                {formatTime(programme.startsAt)}–{formatTime(programme.endsAt)}
                              </span>
                            )}
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {guide && guide.rows.length === PAGE_SIZE && (
          <div className="dialog__foot" style={{ borderTop: '1px solid var(--border)' }}>
            <button className="btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              {t('guide.previousPage', { count: PAGE_SIZE })}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {t('guide.rowsRange', { from: page * PAGE_SIZE + 1, to: (page + 1) * PAGE_SIZE })}
            </span>
            <div className="spacer" />
            <button className="btn" onClick={() => setPage((p) => p + 1)}>
              {t('guide.nextPage', { count: PAGE_SIZE })}
            </button>
          </div>
        )}
      </div>

      {matching && activePlaylistId !== null && (
        <GuideMatching
          playlistId={activePlaylistId}
          onClose={() => setMatching(false)}
          onChanged={() => {
            void invoke('epg:state', activePlaylistId).then(setState)
            void load()
          }}
        />
      )}

      {selected && (
        <div
          className="scrim"
          onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          <div className="dialog" role="dialog" aria-modal="true">
            <div className="dialog__head">
              <h2>{selected.programme.title}</h2>
              <p>
                {formatTime(selected.programme.startsAt)}–{formatTime(selected.programme.endsAt)}
                {selected.programme.category ? ` · ${selected.programme.category}` : ''}
              </p>
            </div>

            <div className="dialog__body">
              <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--text-muted)' }}>
                {selected.programme.description ?? t('guide.noDescription')}
              </p>

              {scheduleNote && (
                <div className={`notice notice--${scheduleNote.kind === 'ok' ? 'success' : 'error'}`}>
                  {scheduleNote.text}
                </div>
              )}
            </div>

            <div className="dialog__foot">
              <button
                className="btn btn--primary"
                disabled={
                  capabilities?.ffmpeg === false || selected.programme.endsAt <= Date.now()
                }
                title={
                  capabilities?.ffmpeg === false
                    ? t('guide.needsFfmpeg')
                    : selected.programme.endsAt <= Date.now()
                      ? t('guide.alreadyFinished')
                      : undefined
                }
                onClick={() => {
                  void invoke('recordings:schedule', {
                    channelId: selected.channelId,
                    title: selected.programme.title,
                    startsAt: selected.programme.startsAt,
                    endsAt: selected.programme.endsAt,
                    // Broadcast times drift; a couple of minutes either side
                    // costs almost nothing and saves a clipped ending.
                    padBeforeMinutes: 2,
                    padAfterMinutes: 5
                  })
                    .then(() =>
                      setScheduleNote({
                        kind: 'ok',
                        text: t('guide.scheduleNote')
                      })
                    )
                    .catch((e) => setScheduleNote({ kind: 'error', text: messageOf(e) }))
                }}
              >
                <IconRecord size={15} />
                {t('guide.record')}
              </button>

              {/* Recording needs ffmpeg and disk; a reminder needs neither, so
                  it stays available for anything still to come. */}
              <button
                className={`btn ${reminder ? 'btn--on' : ''}`}
                disabled={selected.programme.startsAt <= Date.now()}
                title={
                  selected.programme.startsAt <= Date.now()
                    ? t('guide.alreadyStarted')
                    : reminder
                      ? t('guide.cancelReminder')
                      : t('guide.reminderHint')
                }
                onClick={() => {
                  if (reminder) {
                    void invoke('reminders:remove', reminder.id)
                      .then(() => {
                        setReminder(null)
                        setScheduleNote({ kind: 'ok', text: t('guide.reminderCancelled') })
                      })
                      .catch((e) => setScheduleNote({ kind: 'error', text: messageOf(e) }))
                    return
                  }

                  void invoke('reminders:add', {
                    channelId: selected.channelId,
                    title: selected.programme.title,
                    startsAt: selected.programme.startsAt,
                    endsAt: selected.programme.endsAt,
                    leadMinutes: 5
                  })
                    .then((created) => {
                      setReminder(created)
                      setScheduleNote({
                        kind: 'ok',
                        text: t('guide.reminderNote')
                      })
                    })
                    .catch((e) => setScheduleNote({ kind: 'error', text: messageOf(e) }))
                }}
              >
                <IconBell size={15} filled={reminder !== null} />
                {reminder ? t('guide.reminderSet') : t('guide.remindMe')}
              </button>

              <div className="spacer" />
              <button className="btn" onClick={() => setSelected(null)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
