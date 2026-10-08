import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExternalSubtitle, MediaTracks, StreamSource, VideoInfo } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { parseCueBlocks, streamSubtitles } from './subtitles'
import { disableOthers, ensureShowing } from './textTracks'

export interface StreamState {
  status: 'idle' | 'loading' | 'playing' | 'error'
  error: string | null
  /** What ffmpeg is doing: "direct copy", "audio ac3 → aac", and so on. */
  pipeline: string | null
  durationSecs: number | null
  attempt: number
  tracks: MediaTracks
  video: VideoInfo | null
  audioTrack: number | null
  subtitleTrack: number | null
  subtitlesBurnedIn: boolean
  /**
   * True when the element's clock reads as a position in the source.
   *
   * Seeking with a stream copy lands on a keyframe at or before the requested
   * point, so the stream begins slightly early. On an absolute timeline that
   * is visible and correct rather than hidden behind arithmetic.
   */
  absoluteTimeline: boolean
  /**
   * Set when a subtitle track was selected but produced nothing.
   *
   * Subtitles failing quietly is how this went unnoticed through several
   * releases: the menu showed tracks, one could be picked, and the screen
   * stayed blank with no error anywhere. Silence is not an acceptable outcome
   * for a control the user just operated.
   */
  subtitleProblem: string | null
}

const NO_TRACKS: MediaTracks = { audio: [], subtitle: [] }

interface Options {
  source: StreamSource | null
  /** Re-opens the session at this offset. Piped fMP4 cannot seek by itself. */
  seekSecs?: number
  /** Index within the audio tracks. Undefined lets the main process choose. */
  audioTrack?: number
  /** Index within the subtitle tracks, or null for none. */
  subtitleTrack?: number | null
  /** A subtitle file the user opened, shown instead of an embedded track. */
  externalSubtitle?: ExternalSubtitle | null
  /** Seconds added to external cue times, for files that run out of sync. */
  subtitleOffsetSecs?: number
  autoRetry?: boolean
  onOpened?: () => void
}

const MAX_RETRIES = 2

/**
 * Owns a playback session end to end.
 *
 * Every stream is opened in the main process and served over loopback, so the
 * renderer only ever handles a `http://127.0.0.1` URL — the provider URL, which
 * embeds the Xtream password, never reaches this side.
 */
export function useStream({
  source,
  seekSecs = 0,
  audioTrack,
  subtitleTrack,
  externalSubtitle = null,
  subtitleOffsetSecs = 0,
  autoRetry = true,
  onOpened
}: Options): {
  videoRef: React.RefObject<HTMLVideoElement>
  state: StreamState
  reload: () => void
} {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<string | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subtitleAbort = useRef<AbortController | null>(null)

  /**
   * What the main process found wrong with this stream before deciding to play
   * it anyway. The element only ever reports "something failed", so without
   * this a provider at its connection limit and a genuinely dead channel look
   * identical to the user.
   */
  const warningRef = useRef<string | null>(null)

  // Stable for the life of this player. The main process uses it to retire the
  // previous session before opening a new one, so a re-render or a fast channel
  // change never leaves two ffmpeg processes on one provider connection.
  const ownerRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  )

  const [state, setState] = useState<StreamState>({
    status: 'idle',
    error: null,
    pipeline: null,
    durationSecs: null,
    attempt: 0,
    tracks: NO_TRACKS,
    video: null,
    audioTrack: null,
    subtitleTrack: null,
    subtitlesBurnedIn: false,
    absoluteTimeline: false,
    subtitleProblem: null
  })
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const key = source ? `${source.type}:${source.id}` : null

  useEffect(() => {
    const element = videoRef.current
    if (!element || !source) {
      setState({
        status: 'idle',
        error: null,
        pipeline: null,
        durationSecs: null,
        attempt: 0,
        tracks: NO_TRACKS,
        video: null,
        audioTrack: null,
        subtitleTrack: null,
        subtitlesBurnedIn: false,
        absoluteTimeline: false,
        subtitleProblem: null
      })
      return
    }

    let cancelled = false
    let attempt = 0

    const closeSession = (): void => {
      if (sessionRef.current) {
        void invoke('stream:close', sessionRef.current)
        sessionRef.current = null
      }
    }

    const open = async (): Promise<void> => {
      setState((prev) => ({ ...prev, status: 'loading', error: null, attempt }))

      try {
        closeSession()
        const session = await invoke('stream:open', {
          source,
          seekSecs,
          audioTrack,
          subtitleTrack,
          owner: ownerRef.current
        })
        if (cancelled) {
          void invoke('stream:close', session.id)
          return
        }

        sessionRef.current = session.id
        warningRef.current = session.warning
        element.src = session.url

        subtitleAbort.current?.abort()
        subtitleAbort.current = externalSubtitle
          ? null
          : attachSubtitles(element, session.subtitlesUrl, (problem) =>
              setState((prev) => ({ ...prev, subtitleProblem: problem }))
            )

        // The element reports an error asynchronously, so success is only
        // confirmed once it actually starts producing frames.
        await element.play().catch(() => undefined)

        setState({
          status: 'playing',
          error: null,
          pipeline: session.pipeline,
          durationSecs: session.durationSecs,
          attempt,
          tracks: session.tracks,
          video: session.video,
          audioTrack: session.audioTrack,
          subtitleTrack: session.subtitleTrack,
          subtitlesBurnedIn: session.subtitlesBurnedIn,
          absoluteTimeline: session.absoluteTimeline,
          subtitleProblem: null
        })
        onOpened?.()
      } catch (error) {
        if (cancelled) return
        const message = messageOf(error)

        if (autoRetry && attempt < MAX_RETRIES) {
          attempt += 1
          retryTimer.current = setTimeout(() => void open(), 1200 * attempt)
          setState((prev) => ({ ...prev, status: 'loading', attempt }))
          return
        }

        setState((prev) => ({ ...prev, status: 'error', error: message, attempt }))
      }
    }

    /**
     * The element reports a decode or network failure after the session opened
     * cleanly, which is what a stream ffmpeg could not remux looks like from
     * here. Reopening gives the main process the chance to come back
     * re-encoding, so the retry is worth making automatically.
     */
    const onElementError = (): void => {
      if (cancelled) return

      if (autoRetry && attempt < MAX_RETRIES) {
        attempt += 1
        retryTimer.current = setTimeout(() => void open(), 900 * attempt)
        setState((prev) => ({ ...prev, status: 'loading', attempt }))
        return
      }

      setState((prev) =>
        prev.status === 'error'
          ? prev
          : {
              ...prev,
              status: 'error',
              error:
                warningRef.current ??
                'The stream stopped unexpectedly. The provider may have dropped the connection, ' +
                  'reached its connection limit, or the channel is offline.'
            }
      )
    }

    element.addEventListener('error', onElementError)
    void open()

    return () => {
      cancelled = true
      if (retryTimer.current) clearTimeout(retryTimer.current)
      subtitleAbort.current?.abort()
      element.removeEventListener('error', onElementError)
      element.removeAttribute('src')
      element.load()
      closeSession()
    }
    // `key` rather than `source` keeps a fresh object literal from reopening
    // the stream on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seekSecs, audioTrack, subtitleTrack, externalSubtitle, nonce, autoRetry])

  // An external file is already in memory, so switching it or nudging its
  // timing only rebuilds the cue list — no reconnect to the provider.
  useEffect(() => {
    const element = videoRef.current
    // No external file means this effect has nothing of its own on screen, and
    // must leave the stream's subtitles alone. It used to disable them here,
    // which ran a moment after they were attached and was why an embedded
    // subtitle track never showed anything.
    if (!element || !externalSubtitle) return

    const track = element.addTextTrack('subtitles', externalSubtitle.label)
    track.mode = 'showing'
    disableOthers(element, track)

    // A subtitle file's times are positions in the film. On an absolute
    // timeline the element counts the same way, so they line up untouched; on a
    // relative one the stream's own start has to come off.
    const origin = state.absoluteTimeline ? 0 : seekSecs

    const { cues } = parseCueBlocks(`${externalSubtitle.vtt}\n\n`)
    for (const cue of cues) {
      const start = cue.startSecs + subtitleOffsetSecs - origin
      const end = cue.endSecs + subtitleOffsetSecs - origin
      // A cue shifted before the start of the stream cannot be represented.
      if (end <= 0) continue
      try {
        track.addCue(new VTTCue(Math.max(0, start), end, cue.text))
      } catch {
        // One malformed cue must not lose the rest of the file.
      }
    }

    return () => {
      track.mode = 'disabled'
    }
  }, [externalSubtitle, subtitleOffsetSecs, seekSecs, state.status, state.absoluteTimeline])

  return { videoRef, state, reload }
}

/**
 * Subtitle cues are pushed into a TextTrack as they arrive rather than loaded
 * from a `<track src>`, because the WebVTT ffmpeg produces is still growing
 * while the video plays.
 */
/** How long to wait before reattaching after the cue stream drops. */
const SUBTITLE_RECONNECT_MS = 1200

/** Reattach attempts before concluding the track really is producing nothing. */
const SUBTITLE_RECONNECTS = 4

/**
 * Attaches the stream's own subtitle track.
 *
 * No time adjustment is applied, and that is the whole point. ffmpeg is given
 * `-ss <offset>` before the input, so the stream it produces — video and
 * subtitles alike — starts at zero from the seek point, and the element's
 * `currentTime` counts from there too. A cue three seconds into that stream
 * belongs at three seconds.
 *
 * Adding the seek offset here, as this used to, pushed every cue forward by
 * however far into the film the viewer had resumed. At a half-hour resume the
 * subtitles were scheduled half an hour beyond the end of what was playing, so
 * they arrived, parsed, and were never once displayed.
 *
 * A subtitle *file* the user opened is the opposite case — its times are
 * absolute in the source, so that path subtracts the offset. The two must not
 * be confused.
 */
function attachSubtitles(
  element: HTMLVideoElement,
  url: string | null,
  onProblem: (problem: string | null) => void
): AbortController | null {
  if (!url) {
    disableOthers(element, null)
    return null
  }

  const track = element.addTextTrack('subtitles', 'Subtitles')
  track.mode = 'showing'
  disableOthers(element, track)

  // Setting a new src resets tracks to `disabled`, and this runs just before
  // that happens on a reopen — so the mode is re-asserted once the element has
  // the new stream.
  const reassert = (): void => ensureShowing(track)
  element.addEventListener('loadedmetadata', reassert)
  element.addEventListener('loadeddata', reassert)

  const controller = new AbortController()

  /**
   * Cues added so far.
   *
   * The server replays every cue from the beginning to whoever connects, since
   * a client routinely arrives after cues already exist. That makes a
   * reconnect safe but not free: the replayed cues have to be counted past, or
   * every line of dialogue appears twice.
   */
  let added = 0
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  controller.signal.addEventListener('abort', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    element.removeEventListener('loadedmetadata', reassert)
    element.removeEventListener('loadeddata', reassert)
    track.mode = 'disabled'
  })

  const connect = (): void => {
    let seen = 0

    void streamSubtitles({
      url,
      signal: controller.signal,
      // Already in the element's timeline. See the note above.
      offsetSecs: 0,
      onCue: (cue) => {
        // Everything up to `added` is a replay of cues already on the track.
        seen += 1
        if (seen <= added) return

        added = seen
        if (added === 1) onProblem(null)

        try {
          track.addCue(new VTTCue(cue.startSecs, cue.endSecs, cue.text))
        } catch {
          // A malformed cue must not take the stream down with it.
        }
      }
    })
      .then(() => retry(null))
      .catch((error: unknown) => retry(error))
  }

  /**
   * The cue stream ending is not the same as the subtitles being over: the
   * connection can be dropped by a reload, a proxy, or the element reattaching.
   * Giving up on the first end is what left the track permanently blank.
   *
   * Reporting is deliberately tied to the stream *ending* rather than to a
   * timer. A film's first line of dialogue is often minutes in, and a clock
   * that ran out before then accused a perfectly good track of being empty —
   * which is worse than saying nothing, because it sends the viewer hunting
   * through the other tracks for a problem that does not exist. The server
   * closes this stream only once ffmpeg has finished with the whole item, so
   * reaching the end with nothing is real evidence.
   */
  const retry = (error: unknown): void => {
    if (controller.signal.aborted) return

    if (attempt >= SUBTITLE_RECONNECTS) {
      if (added === 0) {
        onProblem(
          error
            ? `Subtitles could not be loaded: ${messageOf(error)}`
            : 'This subtitle track produced no text from beginning to end. It is probably empty — ' +
              'try another track, or open a subtitle file.'
        )
      }
      return
    }

    attempt += 1
    reconnectTimer = setTimeout(connect, SUBTITLE_RECONNECT_MS * attempt)
  }

  connect()

  return controller
}
