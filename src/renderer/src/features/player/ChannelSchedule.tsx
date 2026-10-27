import { useEffect, useState, type JSX } from 'react'
import type { ChannelWithState, EpgProgram } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { formatTime, programProgress } from '@renderer/lib/format'
import { IconBell, IconClose, IconPlay, IconRecord } from '@renderer/ui/Icon'
import { canReplay } from '@shared/catchup'
import { useT } from '@renderer/i18n'

interface Props {
  channel: ChannelWithState
  onClose: () => void
  /** Offered per programme, so the guide is not the only place to record. */
  canRecord: boolean
  /** Replays a finished programme from the provider's archive. */
  onReplay: (programme: EpgProgram) => void
}

/** A day either side: enough to answer "what's on later" and "what did I miss". */
const WINDOW_MS = 24 * 3600_000

/**
 * What is on this channel, without leaving the picture.
 *
 * The full guide is a grid across every channel, which is the wrong shape for
 * the question people actually ask while watching one: what is on after this.
 * Answering it here also means not losing the stream to go and look.
 */
export function ChannelSchedule({ channel, onClose, canRecord, onReplay }: Props): JSX.Element {
  const [programmes, setProgrammes] = useState<EpgProgram[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [reminded, setReminded] = useState<Set<number>>(new Set())
  const t = useT()

  const epgId = channel.epgChannelId

  useEffect(() => {
    if (!epgId) {
      setProgrammes([])
      return
    }

    const now = Date.now()
    void invoke('epg:channelProgrammes', {
      epgChannelId: epgId,
      from: now - 3 * 3600_000,
      to: now + WINDOW_MS
    })
      .then(setProgrammes)
      .catch(() => setProgrammes([]))
  }, [epgId])

  const now = Date.now()

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog__head">
          <h2>{channel.name}</h2>
          <p>{t('schedule.body')}</p>
          <button className="btn btn--ghost sheet__close" onClick={onClose} aria-label={t('common.close')}>
            <IconClose size={16} />
          </button>
        </div>

        <div className="dialog__body" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {programmes === null && (
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>{t('common.loading')}</p>
          )}

          {programmes?.length === 0 && (
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
              {epgId ? t('schedule.nothingForChannel') : t('schedule.noGuideId')}
            </p>
          )}

          {programmes?.map((programme) => {
            const live = now >= programme.startsAt && now < programme.endsAt
            const past = programme.endsAt <= now

            return (
              <div key={programme.id} className={`schedrow ${live ? 'schedrow--live' : ''}`}>
                <span className="schedrow__time">{formatTime(programme.startsAt)}</span>

                <span className="schedrow__text" style={{ opacity: past ? 0.5 : 1 }}>
                  <strong>{programme.title}</strong>
                  {programme.description && <span>{programme.description}</span>}
                  {live && (
                    <span className="progressbar">
                      <span
                        className="progressbar__fill"
                        style={{ width: `${programProgress(programme.startsAt, programme.endsAt) * 100}%` }}
                      />
                    </span>
                  )}
                </span>

                {/*
                  Only offered where there is actually something to replay. A
                  channel with no archive, or a programme older than the window
                  the provider keeps, would cost a connection to be told no.
                */}
                {canReplay(programme, channel.catchupDays, now) && (
                  <button
                    className="btn btn--ghost"
                    title={t('catchup.replay')}
                    aria-label={t('catchup.replayOne', { title: programme.title })}
                    onClick={() => onReplay(programme)}
                  >
                    <IconPlay size={14} />
                  </button>
                )}

                {!past && (
                  <button
                    className={`btn btn--ghost ${reminded.has(programme.id) ? 'btn--on' : ''}`}
                    title={reminded.has(programme.id) ? t('guide.reminderSet') : t('schedule.remindBefore')}
                    aria-label={t('schedule.remindAbout', { title: programme.title })}
                    onClick={() => {
                      void invoke('reminders:add', {
                        channelId: channel.id,
                        title: programme.title,
                        startsAt: programme.startsAt,
                        endsAt: programme.endsAt,
                        leadMinutes: 5
                      })
                        .then(() => {
                          setReminded((current) => new Set(current).add(programme.id))
                          setNote(t('schedule.reminded', { title: programme.title }))
                        })
                        .catch(() => setNote(t('schedule.reminderFailed')))
                    }}
                  >
                    <IconBell size={14} filled={reminded.has(programme.id)} />
                  </button>
                )}

                {!past && canRecord && (
                  <button
                    className="btn btn--ghost"
                    title={t('schedule.recordThis')}
                    aria-label={t('schedule.recordTitle', { title: programme.title })}
                    onClick={() => {
                      void invoke('recordings:schedule', {
                        channelId: channel.id,
                        title: programme.title,
                        startsAt: programme.startsAt,
                        endsAt: programme.endsAt,
                        // Broadcast times drift; a little padding costs almost
                        // nothing and saves a clipped ending.
                        padBeforeMinutes: 2,
                        padAfterMinutes: 5
                      })
                        .then(() => setNote(t('schedule.recordScheduled', { title: programme.title })))
                        .catch(() => setNote(t('schedule.recordFailed')))
                    }}
                  >
                    <IconRecord size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {note && <div className="notice notice--success" style={{ margin: '0 16px' }}>{note}</div>}

        <div className="dialog__foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
