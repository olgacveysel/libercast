import { randomUUID, randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { MediaTrack, MediaTracks, VideoInfo } from '@shared/types'
import {
  buildStreamArgs,
  looksLikeBadOption,
  planRemux,
  redactArgs,
  rejectOption,
  type StreamCodecs
} from './args'
import { ffmpegPath } from './binaries'
import { sameLanguage } from './languages'
import { probeStream, type ProbeResult } from './probe'
import { inspectStream } from './httpCheck'
import { createLogger, errorMessage } from '@main/util/logger'

const log = createLogger('stream')

export interface SessionSpec {
  /** The provider URL, credentials and all. Never leaves the main process. */
  url: string
  /**
   * The same item at a different container extension. Tried in order when the
   * primary URL turns out not to be a video stream.
   */
  alternates?: string[]
  /** A live channel, known from the catalogue rather than by asking. */
  isLive?: boolean
  /** Play a live channel on assumption rather than spending a probe on it. */
  frugal?: boolean
  userAgent?: string | null
  referrer?: string | null
  seekSecs?: number
  label: string
  /** Index within the audio tracks; omitted means pick by preference. */
  audioTrack?: number
  /** Index within the subtitle tracks, null for none, omitted means preference. */
  subtitleTrack?: number | null
  preferredAudioLanguages?: string[]
  preferredSubtitleLanguages?: string[]
  /**
   * Identifies the player asking. A second open from the same player replaces
   * the first, so a re-render or a fast channel change cannot leave two ffmpeg
   * processes competing for the provider's single allowed connection.
   */
  owner?: string
}

export interface OpenedSession {
  id: string
  url: string
  seekable: boolean
  durationSecs: number | null
  codecs: StreamCodecs
  pipeline: string
  tracks: MediaTracks
  video: VideoInfo | null
  audioTrack: number | null
  subtitleTrack: number | null
  subtitlesUrl: string | null
  subtitlesBurnedIn: boolean
  /**
   * True when the stream carries the source's own timestamps, so the media
   * element's clock reads as a position in the film rather than as time since
   * this particular stream started.
   */
  absoluteTimeline: boolean
  /**
   * What went wrong before playback was attempted anyway, if anything. Shown
   * only if the stream then fails, so the user reads the real cause instead of
   * a generic "the stream stopped".
   */
  warning: string | null
}

interface Session extends SessionSpec {
  id: string
  child: ChildProcess | null
  audioIndex: number
  subtitleIndex: number | null
  burnIn: boolean
  /**
   * File ffmpeg writes WebVTT into, when a text subtitle is selected. It is
   * read by polling rather than piped, because a pipe on a descriptor above
   * stderr is a POSIX-only arrangement and simply did not exist on Windows.
   */
  vttPath: string | null
  /** Set once ffmpeg has exited and the file has stopped growing. */
  vttDone: boolean
  /** Everything ffmpeg has written to the file so far, verbatim. */
  vttRaw: string
  /** What has been sent to clients: vttRaw with its WEBVTT header removed. */
  vttBody: string
  /** Clients currently following the cues. */
  vttListeners: Set<ServerResponse>
  /** Polls the file. Runs while ffmpeg does, whether or not anyone is reading. */
  vttTailer: ReturnType<typeof setInterval> | null
  /** See TrackSelection.absoluteTimestamps. Decided once, at open. */
  absoluteTimeline: boolean
  createdAt: number
}

/**
 * A loopback HTTP server that hands the renderer a playable stream.
 *
 * Three problems are solved at once. Chromium cannot demux MPEG-TS, which is
 * what most providers serve for live channels — ffmpeg remuxes it to fragmented
 * MP4. The provider URL is only ever used here, so the renderer never sees the
 * Xtream password embedded in it. And subtitles come out of the *same* ffmpeg
 * process on a second pipe, so selecting a subtitle costs no extra connection
 * to a provider that probably allows only one.
 */
export class StreamServer {
  private server: Server | null = null
  private port = 0
  private token = ''
  private readonly sessions = new Map<string, Session>()

  /**
   * Streams whose copy attempt failed at the muxer. Remembering them means the
   * retry re-encodes instead of repeating the failure, and the memory is keyed
   * by stream rather than by session so it survives the reopen.
   */
  private readonly degraded = new Set<string>()

  /**
   * Items whose stored container extension was wrong, mapped to the URL that
   * actually worked. Without this the HTTP checks would run again on every
   * reopen — and a track change or a seek reopens the stream.
   */
  private readonly corrected = new Map<string, string>()

  async start(): Promise<void> {
    if (this.server) return

    this.token = randomBytes(24).toString('hex')

    const server = createServer((request, response) => {
      void this.handle(request, response)
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // Loopback only: nothing outside this machine can reach it.
      server.listen(0, '127.0.0.1', () => resolve())
    })

    this.server = server
    this.port = (server.address() as AddressInfo).port
    log.info(`stream server listening on 127.0.0.1:${this.port}`)
  }

  async open(spec: SessionSpec): Promise<OpenedSession> {
    await this.start()

    // Retire whatever this player had open before starting anything new.
    if (spec.owner) this.closeOwnedBy(spec.owner)

    const resolved = await this.resolveUrl(spec)
    const url = resolved.url
    const probe = resolved.probe
    const plan = planRemux(probe, this.degraded.has(streamKey(url)))

    const audioIndex = chooseAudio(probe.tracks.audio, spec.audioTrack, spec.preferredAudioLanguages)
    const subtitleIndex = chooseSubtitle(
      probe.tracks.subtitle,
      spec.subtitleTrack,
      spec.preferredSubtitleLanguages
    )

    const chosenSubtitle = subtitleIndex === null ? null : probe.tracks.subtitle[subtitleIndex] ?? null
    // A bitmap subtitle is a picture, not text, so the only way to show it is
    // to draw it onto the video — which forces a re-encode.
    const burnIn = chosenSubtitle !== null && !chosenSubtitle.isTextBased

    // A known duration means a file the provider can seek within — VOD. Live
    // has no duration and needs its timestamps normalised, which is the case
    // the zeroing exists for.
    const absoluteTimeline = probe.durationSecs !== null && probe.durationSecs > 0

    const id = randomUUID()
    // Decided here, not when the video request arrives. The renderer sets
    // `element.src` and then immediately fetches the subtitle URL, and the
    // subtitle request usually reaches this server FIRST — so anything derived
    // from the video request is still unset when the subtitles are asked for.
    const vttPath =
      subtitleIndex !== null && !burnIn ? join(tmpdir(), `libercast-${id}.vtt`) : null

    this.sessions.set(id, {
      ...spec,
      url,
      id,
      child: null,
      audioIndex,
      subtitleIndex,
      burnIn,
      vttPath,
      absoluteTimeline,
      vttDone: false,
      vttRaw: '',
      vttBody: '',
      vttListeners: new Set(),
      vttTailer: null,
      createdAt: Date.now()
    })

    const notes = [plan.reason]
    if (resolved.corrected) notes.push('corrected container')
    if (probe.tracks.audio.length > 1) notes.push(`audio ${audioIndex + 1}/${probe.tracks.audio.length}`)
    if (burnIn) notes.push('subtitles burned in')

    log.info(`session ${id} for ${spec.label}: ${notes.join(', ')}`)

    return {
      id,
      url: `http://127.0.0.1:${this.port}/stream/${id}?token=${this.token}`,
      // A piped fMP4 has no index, so the element cannot seek within it. VOD
      // seeking reopens the session at an offset instead.
      seekable: false,
      durationSecs: probe.durationSecs,
      codecs: probe,
      pipeline: notes.join(', '),
      tracks: probe.tracks,
      video: probe.videoInfo,
      audioTrack: probe.tracks.audio.length > 0 ? audioIndex : null,
      subtitleTrack: subtitleIndex,
      subtitlesUrl:
        subtitleIndex !== null && !burnIn
          ? `http://127.0.0.1:${this.port}/subtitles/${id}?token=${this.token}`
          : null,
      subtitlesBurnedIn: burnIn,
      absoluteTimeline,
      warning: resolved.warning
    }
  }

  /**
   * Finds a URL for this item that is actually a stream, and probes it.
   *
   * Nothing here runs on the happy path: a stream that probes cleanly returns
   * immediately, so live channels are untouched. It engages only when ffprobe
   * could not open the URL, which is where the app used to give up silently and
   * transcode something it had never read a byte of.
   *
   * It never refuses to play. ffmpeg is more tolerant than ffprobe and more
   * tolerant than this check, and a provider that answers one request badly
   * often answers the next one fine — so a bad diagnosis becomes a message held
   * in reserve, shown only if playback then fails. Refusing on it outright made
   * films unplayable that another player could open.
   */
  private async resolveUrl(
    spec: SessionSpec
  ): Promise<{ url: string; probe: ProbeResult; corrected: boolean; warning: string | null }> {
    const options = { userAgent: spec.userAgent, referrer: spec.referrer }
    const key = streamKey(spec.url)

    // A previous open already worked out which extension this item really uses.
    const remembered = this.corrected.get(key)
    if (remembered) {
      const probe = await probeStream(remembered, options)
      if (probe.ok) return { url: remembered, probe, corrected: true, warning: null }
      this.corrected.delete(key)
    }

    // Nothing stored, and the account cannot spare the connection. A live
    // channel is overwhelmingly h264 and AAC in MPEG-TS; if the guess is wrong
    // ffmpeg says so within a second or two and the retry comes back
    // re-encoding, which is the same recovery an unexpected codec already gets.
    if (spec.frugal && spec.isLive) {
      log.info(`${spec.label}: playing without identifying it first, to spend one connection`)
      return { url: spec.url, probe: assumedLiveCodecs(), corrected: false, warning: null }
    }

    const probe = await probeStream(spec.url, options)
    if (probe.ok) return { url: spec.url, probe, corrected: false, warning: null }

    // A local recording or download has no provider to interrogate, and ffprobe
    // failing on one is not a reason to refuse to play it — ffmpeg copes with
    // partial files that ffprobe rejects, and a still-recording file is exactly
    // that.
    if (!/^https?:/i.test(spec.url)) {
      return { url: spec.url, probe, corrected: false, warning: null }
    }

    // ffprobe failed. Find out what the provider is actually sending, because
    // "Invalid data found when processing input" describes the bytes and not
    // the reason, and the reason is what the user can act on.
    const check = await inspectStream(spec.url, options)

    if (check.ok) {
      // The URL serves media but ffprobe could not read it — a truncated or
      // unusual stream. ffmpeg is the more tolerant of the two; let it try.
      log.warn(
        `probe failed for ${spec.label} but the URL serves ${check.container ?? 'media'}; playing anyway`
      )
      return { url: spec.url, probe, corrected: false, warning: null }
    }

    log.warn(`${spec.label}: ${check.reason ?? 'the provider did not return a stream'}`)

    // Only a clear answer — an error status, or a web page where video should
    // be — justifies spending more of the account's connections looking for a
    // different container extension. "No data" means the provider is busy, and
    // hammering it with three more requests is the worst possible response.
    if (check.definitive) {
      for (const candidate of spec.alternates ?? []) {
        const alternate = await inspectStream(candidate, options)
        if (!alternate.ok) continue

        const alternateProbe = await probeStream(candidate, options)
        log.info(
          `${spec.label}: the provider serves ${alternate.container ?? 'media'} here, not what it listed`
        )
        this.corrected.set(key, candidate)
        return { url: candidate, probe: alternateProbe, corrected: true, warning: null }
      }
    }

    // Play anyway, carrying the explanation in case it fails.
    return {
      url: spec.url,
      probe,
      corrected: false,
      warning: check.reason ?? probe.error ?? null
    }
  }

  private closeOwnedBy(owner: string): void {
    for (const [id, session] of this.sessions) {
      if (session.owner === owner) {
        this.kill(session)
        void this.dropSubtitleFile(session)
        this.sessions.delete(id)
      }
    }
  }

  /**
   * Whether anything is playing. The automatic refresh asks before it starts,
   * because a sync opens connections to the same provider and most accounts
   * allow very few.
   */
  hasSessions(): boolean {
    return this.sessions.size > 0
  }

  close(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.kill(session)
    void this.dropSubtitleFile(session)
    this.sessions.delete(id)
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      this.kill(session)
      void this.dropSubtitleFile(session)
    }
    this.sessions.clear()
    this.server?.close()
    this.server = null
  }

  private kill(session: Session): void {
    if (!session.child) return
    session.child.stdout?.destroy()
    session.child.kill('SIGKILL')
    session.child = null
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const parsed = new URL(request.url ?? '', 'http://127.0.0.1')

    // The token stops any other local process from reading the user's streams.
    if (parsed.searchParams.get('token') !== this.token) {
      response.writeHead(404).end()
      return
    }

    // A preflight carries no token; answering it is what allows the request
    // that does carry one.
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...CORS_HEADERS, 'Content-Length': '0' }).end()
      return
    }

    const stream = /^\/stream\/([0-9a-f-]{36})$/i.exec(parsed.pathname)
    if (stream) {
      await this.serveVideo(stream[1]!, request, response)
      return
    }

    const subtitles = /^\/subtitles\/([0-9a-f-]{36})$/i.exec(parsed.pathname)
    if (subtitles) {
      await this.serveSubtitles(subtitles[1]!, request, response)
      return
    }

    response.writeHead(404).end()
  }

  private async serveVideo(
    id: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) {
      response.writeHead(410).end()
      return
    }

    // A reload or a React remount can request the same session twice; the old
    // ffmpeg has to go or two processes fight over one provider connection.
    this.kill(session)
    // ffmpeg is about to rewrite this file from the beginning.
    this.stopTailing(session)
    await this.clearSubtitleFile(session)
    session.vttDone = false
    session.vttRaw = ''
    session.vttBody = ''

    let child: ChildProcess
    try {
      const probe = await probeStream(session.url, {
        userAgent: session.userAgent,
        referrer: session.referrer
      })

      const args = buildStreamArgs(session.url, planRemux(probe, this.degraded.has(streamKey(session.url))), {
        userAgent: session.userAgent,
        referrer: session.referrer,
        seekSecs: session.seekSecs,
        audioIndex: session.audioIndex,
        subtitleIndex: session.subtitleIndex,
        burnInSubtitles: session.burnIn,
        subtitlePath: session.vttPath ?? undefined,
        absoluteTimestamps: session.absoluteTimeline
      })

      log.debug('spawning ffmpeg', redactArgs(args).join(' '))

      child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      log.error('could not start ffmpeg', errorMessage(error))
      response.writeHead(500).end()
      return
    }

    session.child = child
    this.startTailing(session)

    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      Connection: 'close'
    })

    child.stdout?.pipe(response)

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      // Keep only the tail: a failing stream can produce megabytes of warnings.
      stderr = (stderr + chunk.toString()).slice(-2000)
    })

    const startedAt = Date.now()

    child.on('exit', (code) => {
      const detail = stderr.trim()

      if (code !== 0 && code !== null && detail) {
        log.warn(`ffmpeg exited ${code} for ${session.label}`, detail.split('\n').slice(-3).join(' | '))

        // ffmpeg refused an option rather than the stream, which kills every
        // playback attempt until the option stops being sent. Dropping the
        // tuning options and letting the player's own retry come back is the
        // difference between one bad flag degrading playback and ending it.
        if (looksLikeBadOption(detail)) {
          const dropped = rejectOption(detail)
          if (dropped) log.warn(`this ffmpeg build does not support -${dropped}; continuing without it`)
        }

        // A stream that dies almost immediately with a bitstream or muxing
        // complaint cannot be copied into MP4. Recording that here means the
        // player's own retry comes back re-encoding and simply works.
        if (Date.now() - startedAt < 20_000 && looksUncopyable(detail)) {
          const key = streamKey(session.url)
          if (!this.degraded.has(key)) {
            this.degraded.add(key)
            log.info(`marking ${session.label} as needing a re-encode`)
          }
        }
      }

      // The file stops growing shortly after ffmpeg exits; the tailer reads
      // once more and then closes the followers itself.
      session.vttDone = true
      response.end()
    })

    const stop = (): void => {
      if (session.child === child) this.kill(session)
    }
    request.on('close', stop)
    response.on('close', stop)
  }

  /**
   * Follows the subtitle file for as long as ffmpeg is writing it.
   *
   * The tailer belongs to the session, not to a client. Three rounds of this
   * bug came from tying the reading to an HTTP request: the renderer asks for
   * the subtitle URL in the same breath as the video, drops and re-issues that
   * request as the element loads, and a reader that lives and dies with one
   * request therefore sees nothing. Cues are now collected whether or not
   * anyone is listening, and a client that arrives — or comes back — is sent
   * everything from the beginning.
   */
  private startTailing(session: Session): void {
    if (!session.vttPath || session.vttTailer) return

    let missing = 0
    let reported = false
    // The reads are asynchronous and the interval is not: without this, two
    // ticks can overlap and compute their deltas from the same starting point.
    let reading = false

    /** Reads once and sends whatever is new. Returns false if the file is absent. */
    const drain = async (): Promise<boolean> => {
      if (!session.vttPath) return false

      const read = await readWhole(session.vttPath)

      if (read.error) {
        // Reading a file another process holds open is normally fine, but if it
        // is ever refused this is the only place that would know.
        if (!reported) {
          reported = true
          log.warn(`cannot read the subtitle file for ${session.label}`, read.error)
        }
        return false
      }

      if (read.content === null) return false

      if (read.content.length !== session.vttRaw.length) {
        session.vttRaw = read.content
        const body = stripHeader(read.content)
        const delta = body.slice(session.vttBody.length)

        if (delta.length > 0) {
          if (session.vttBody.length === 0) log.info(`subtitles arriving for ${session.label}`)
          session.vttBody = body
          for (const listener of session.vttListeners) listener.write(delta)
        }
      }

      return true
    }

    session.vttTailer = setInterval(() => {
      if (reading) return
      reading = true

      void (async () => {
        try {
          const present = await drain()
          if (!present) missing += 1

          if (!session.vttDone) return

          // ffmpeg has gone. Read once more before closing: it writes its last
          // cues and exits, and a read taken just before that exit misses them.
          // Skipping this truncated the subtitles at the end of every stream.
          await drain()

          if (session.vttBody.length === 0 && missing > 0) {
            log.warn(
              `subtitle track ${session.subtitleIndex} for ${session.label} produced no text — ` +
                'the track may be empty, or a picture rather than text'
            )
          }

          this.stopTailing(session)
          for (const listener of session.vttListeners) listener.end()
          session.vttListeners.clear()
        } finally {
          reading = false
        }
      })()
    }, SUBTITLE_POLL_MS)
  }

  private stopTailing(session: Session): void {
    if (session.vttTailer) clearInterval(session.vttTailer)
    session.vttTailer = null
  }

  /**
   * Sends the cues collected so far and then follows along.
   *
   * Replaying from the start matters: this request is routinely made before
   * ffmpeg has produced a single cue, and just as routinely made again after
   * the element reloads, by which point several minutes of dialogue may
   * already have been written.
   */
  private serveSubtitles(id: string, request: IncomingMessage, response: ServerResponse): void {
    const session = this.sessions.get(id)

    // No path means no text subtitle was selected — the only honest refusal.
    if (!session?.vttPath) {
      log.debug(`subtitle request for ${id} refused: no text subtitle on this session`)
      response.writeHead(410).end()
      return
    }

    response.writeHead(200, {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      Connection: 'close'
    })

    // A WebVTT stream must open with this line, and the cue text held in
    // vttBody has had ffmpeg's own header removed, so there is exactly one.
    response.write('WEBVTT\n\n')
    if (session.vttBody.length > 0) response.write(session.vttBody)

    if (session.vttDone && session.vttTailer === null) {
      response.end()
      return
    }

    session.vttListeners.add(response)
    const drop = (): void => {
      session.vttListeners.delete(response)
    }
    request.on('close', drop)
    response.on('close', drop)
  }

  /**
   * Deletes the file from a previous run of this session, keeping the path.
   *
   * The path must outlive the ffmpeg process that writes it, because the
   * renderer holds a URL derived from it across retries and track changes.
   */
  private async clearSubtitleFile(session: Session): Promise<void> {
    if (!session.vttPath) return
    await rm(session.vttPath, { force: true }).catch(() => undefined)
  }

  /** Removes the temp file for good, when the session itself is going away. */
  private async dropSubtitleFile(session: Session): Promise<void> {
    this.stopTailing(session)
    for (const listener of session.vttListeners) listener.end()
    session.vttListeners.clear()
    await this.clearSubtitleFile(session)
    session.vttPath = null
  }
}

/**
 * Explicit choice wins; otherwise the first track matching a preferred
 * language; otherwise whatever the container marks default; otherwise the
 * first track.
 */
export function chooseAudio(
  tracks: MediaTrack[],
  explicit: number | undefined,
  preferred: string[] | undefined
): number {
  if (tracks.length === 0) return 0
  if (explicit !== undefined && tracks[explicit]) return explicit

  for (const language of preferred ?? []) {
    const match = tracks.find((track) => sameLanguage(track.language, language))
    if (match) return match.index
  }

  return tracks.find((track) => track.isDefault)?.index ?? 0
}

/**
 * Subtitles stay off unless asked for, because turning them on for everyone
 * who happens to have a subtitle track would be wrong. `null` means off, and
 * an explicit null is respected over any preference.
 */
export function chooseSubtitle(
  tracks: MediaTrack[],
  explicit: number | null | undefined,
  preferred: string[] | undefined
): number | null {
  if (explicit === null) return null
  if (explicit !== undefined && tracks[explicit]) return explicit
  if (tracks.length === 0) return null

  for (const language of preferred ?? []) {
    const match = tracks.find((track) => sameLanguage(track.language, language))
    if (match) return match.index
  }

  return null
}

/**
 * Lets the renderer read these responses at all.
 *
 * The renderer is served from localhost:5173 in development and from a file
 * URL when packaged; this server is on 127.0.0.1 at a random port. Those are
 * different origins, so `fetch` is subject to CORS — and without this header
 * the browser discards the response before the app sees a single byte.
 *
 * The video worked throughout because a `<video src>` is not a fetch and is
 * not subject to CORS. Only the subtitles, which are fetched, were blocked:
 * the request reached the server, ffmpeg produced every cue, and the browser
 * threw the lot away. That is why the log said subtitles were arriving while
 * the screen stayed empty.
 *
 * Opening this up is safe here: the server listens on loopback only and every
 * request must carry a random per-session token that never leaves the app.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  // A plain GET with no custom headers needs no preflight, but stating this
  // keeps a future change from quietly reintroducing the same silence.
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type'
} as const

/** How often the subtitle file is checked for new cues. */
const SUBTITLE_POLL_MS = 400

/**
 * Reads the whole file.
 *
 * The files are small — a two-hour film's subtitles are well under a megabyte
 * — so reading all of it each time is cheaper than tracking an offset, and it
 * is immune to ffmpeg restarting and rewriting the file from the top, which
 * offset tracking got wrong.
 *
 * The three outcomes are kept distinct: `content: null` means the file does
 * not exist yet, which is the normal state for the first seconds and not a
 * problem; `error` means it exists and could not be read, which is.
 */
async function readWhole(path: string): Promise<{ content: string | null; error: string | null }> {
  try {
    return { content: await readFile(path, 'utf8'), error: null }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { content: null, error: null }
    return { content: null, error: errorMessage(error) }
  }
}

/**
 * Removes ffmpeg's own WEBVTT header, since the response already opened with
 * one.
 *
 * It also has to cope with a half-written header: the muxer flushes `WEBVTT`
 * and its newline before the blank line that terminates it, and a pattern that
 * insisted on the blank line let a second `WEBVTT` through to the client.
 */
export function stripHeader(content: string): string {
  const withoutBom = content.replace(/^\uFEFF/, '')
  if (!/^WEBVTT/.test(withoutBom)) return withoutBom

  // Drop the header line and any metadata lines up to the first blank line.
  const blank = withoutBom.search(/\n[ \t]*\n/)
  if (blank === -1) return ''
  return withoutBom.slice(blank + 1).replace(/^[ \t]*\n/, '')
}

/**
 * What a live channel almost always is.
 *
 * Used only when the account cannot spare a connection for identifying it.
 * Being wrong is recoverable — ffmpeg fails at the muxer within a second and
 * the reopen re-encodes — whereas spending the connection is not, because the
 * provider then refuses the one playback needs.
 */
function assumedLiveCodecs(): ProbeResult {
  return {
    video: 'h264',
    audio: 'aac',
    durationSecs: null,
    container: 'mpegts',
    // Nothing has enumerated the tracks, so the pickers stay empty until this
    // channel has been played once and its answer stored.
    tracks: { audio: [], subtitle: [] },
    videoInfo: null,
    ok: true,
    error: null
  }
}

/** Identifies a stream without carrying its credentials. */
function streamKey(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return url
  }
}

/** ffmpeg complaints that mean "this cannot be stream-copied into MP4". */
export function looksUncopyable(stderr: string): boolean {
  const text = stderr.toLowerCase()
  return (
    text.includes('malformed aac bitstream') ||
    text.includes('bitstream filter') ||
    text.includes('error muxing a packet') ||
    text.includes('could not find tag for codec') ||
    text.includes('error submitting a packet to the muxer') ||
    text.includes('track 0 : no compatible tag found')
  )
}

export const streamServer = new StreamServer()
