import { useEffect, useState, type JSX } from 'react'
import type { ChannelWithState, EpgProgram } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { formatTime, programProgress } from '@renderer/lib/format'
import { IconBell, IconClose, IconRecord } from '@renderer/ui/Icon'

interface Props {
  channel: ChannelWithState
  onClose: () => void
  /** Offered per programme, so the guide is not the only place to record. */
  canRecord: boolean
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
export function ChannelSchedule({ channel, onClose, canRecord }: Props): JSX.Element {
  const [programmes, setProgrammes] = useState<EpgProgram[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [reminded, setReminded] = useState<Set<number>>(new Set())

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
          <p>What is on today. Times come from the guide, so they are as accurate as it is.</p>
          <button className="btn btn--ghost sheet__close" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>

        <div className="dialog__body" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {programmes === null && <p style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>Loading…</p>}

          {programmes?.length === 0 && (
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
              {epgId
                ? 'The guide has nothing for this channel. Guide matching in the Guide screen can point it at the right feed.'
                : 'The provider gave this channel no guide id, so nothing can be matched to it. The Guide screen can set one by hand.'}
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

                {!past && (
                  <button
                    className={`btn btn--ghost ${reminded.has(programme.id) ? 'btn--on' : ''}`}
                    title={reminded.has(programme.id) ? 'Reminder set' : 'Remind me before it starts'}
                    aria-label={`Remind me about ${programme.title}`}
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
                          setNote(`You will be reminded before ${programme.title} starts.`)
                        })
                        .catch(() => setNote('That reminder could not be set.'))
                    }}
                  >
                    <IconBell size={14} filled={reminded.has(programme.id)} />
                  </button>
                )}

                {!past && canRecord && (
                  <button
                    className="btn btn--ghost"
                    title="Record this programme"
                    aria-label={`Record ${programme.title}`}
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
                        .then(() => setNote(`${programme.title} will be recorded. It appears in Library.`))
                        .catch(() => setNote('That recording could not be scheduled.'))
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
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
