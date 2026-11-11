import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Recording, RecordingRequest } from '@shared/types'
import { getChannel } from '@main/db/repo/catalog'
import { renderTemplate } from '@shared/filename'
import { getSettings } from '@main/db/repo/settings'
import * as repo from '@main/db/repo/recordings'
import { resolveProviderStream } from './resolve'
import { createLogger, errorMessage } from '@main/util/logger'
import { buildRecordArgs, recordingContainer, redactArgs } from './args'
import { binaries, ffmpegPath } from './binaries'
import { probeStream } from './probe'

const log = createLogger('recorder')

/** How long a stopping recording gets to finish its file before it is killed. */
const STOP_GRACE_MS = 8000

/** How long quitting waits for every recording to finish. */
const SHUTDOWN_WAIT_MS = 12_000

/** How long ffprobe gets to answer whether a finished file can be opened. */
const VERIFY_TIMEOUT_MS = 10_000

export type RecordingListener = (recording: Recording) => void

interface ActiveJob {
  recordingId: number
  child: ChildProcess
  filePath: string
  /** Set when the user asked to stop, so a clean exit is not reported as a failure. */
  stopping: boolean
  /** Resolves once the process has exited and its row has been written. */
  done: Promise<void>
}

/**
 * Runs and tracks recordings.
 *
 * ffmpeg copies the provider's stream straight to disk without re-encoding, so
 * a recording costs almost no CPU and is bit-identical to what was broadcast.
 */
class Recorder {
  private readonly jobs = new Map<number, ActiveJob>()
  private listener: RecordingListener | null = null
  private sizeTimer: ReturnType<typeof setInterval> | null = null

  onChange(listener: RecordingListener): void {
    this.listener = listener
  }

  private emit(recording: Recording | null): void {
    if (recording && this.listener) this.listener(recording)
  }

  async outputDirectory(): Promise<string> {
    const configured = getSettings().recordingsPath
    const directory = configured ?? join(app.getPath('videos'), 'LiberCast')
    await mkdir(directory, { recursive: true })
    return directory
  }

  /** Starts immediately and runs until `endsAt` or an explicit stop. */
  async startNow(request: RecordingRequest): Promise<Recording> {
    const channel = getChannel(request.channelId)
    if (!channel) throw new Error('Channel not found')

    const clash = repo.clashesWith(request.channelId, Date.now(), request.endsAt)
    if (clash) throw new Error(`Already recording "${clash.title}" on this channel`)

    const recording = repo.createRecording({
      channelId: channel.id,
      playlistId: channel.playlistId,
      title: request.title,
      channelName: channel.name,
      startsAt: Date.now(),
      endsAt: request.endsAt,
      status: 'recording'
    })

    await this.spawn(recording)
    return repo.getRecording(recording.id) ?? recording
  }

  schedule(request: RecordingRequest): Recording {
    const channel = getChannel(request.channelId)
    if (!channel) throw new Error('Channel not found')

    const padBefore = (request.padBeforeMinutes ?? 0) * 60_000
    const padAfter = (request.padAfterMinutes ?? 0) * 60_000
    const startsAt = (request.startsAt ?? Date.now()) - padBefore
    const endsAt = request.endsAt + padAfter

    if (endsAt <= Date.now()) throw new Error('That programme has already finished')

    const clash = repo.clashesWith(request.channelId, startsAt, endsAt)
    if (clash) throw new Error(`Overlaps an existing recording of "${clash.title}"`)

    const recording = repo.createRecording({
      channelId: channel.id,
      playlistId: channel.playlistId,
      title: request.title,
      channelName: channel.name,
      startsAt,
      endsAt,
      status: 'scheduled'
    })

    this.emit(recording)
    return recording
  }

  async begin(recording: Recording): Promise<void> {
    if (this.jobs.has(recording.id)) return
    await this.spawn(recording)
  }

  stop(recordingId: number): Recording | null {
    const job = this.jobs.get(recordingId)

    if (!job) {
      // Not running, so this is a scheduled recording being cancelled.
      const updated = repo.updateRecording(recordingId, { status: 'cancelled', finishedAt: Date.now() })
      this.emit(updated)
      return updated
    }

    this.requestStop(job)
    return repo.getRecording(recordingId)
  }

  /**
   * Asks ffmpeg to finish, rather than killing it.
   *
   * This used to send SIGINT, which is right on Linux and does nothing of the
   * kind on Windows: Node has no way to deliver a POSIX signal there, so
   * libuv turns `kill('SIGINT')` into `TerminateProcess` — a hard kill. ffmpeg
   * never got to write the `moov` atom, and an MP4 without one will not open
   * in anything. Every stopped recording on Windows was a dead file, and the
   * row said `completed`.
   *
   * `q` on stdin is ffmpeg's own quit command and behaves the same on every
   * platform: it leaves the input, flushes the muxer and writes the trailer.
   * That is why stdin is a pipe now instead of being closed.
   *
   * The kill stays as a last resort, several seconds later, for a process that
   * has stopped reading its own stdin. What a kill leaves behind is no longer
   * reported as a recording — see `finalize`.
   */
  private requestStop(job: ActiveJob): void {
    if (job.stopping) return
    job.stopping = true

    try {
      job.child.stdin?.write('q\n')
    } catch {
      // The pipe is already gone, which means the process is on its way out.
    }

    setTimeout(() => {
      if (!this.jobs.has(job.recordingId)) return
      log.warn(`recording ${job.recordingId} did not finish its file in time; killing it`)
      job.child.kill('SIGKILL')
    }, STOP_GRACE_MS)
  }

  isRunning(recordingId: number): boolean {
    return this.jobs.has(recordingId)
  }

  /**
   * Stops everything and waits for the files to be finished.
   *
   * Awaited on the way out of the application. The quit path used to call this
   * and then close the database in the next statement, which is the same bug
   * in a different place: `stopAll` only *asked* the processes to stop, so the
   * database was shut before any of them had exited and the final row was
   * written against a closed handle.
   *
   * The wait is bounded. A recording that will not finish is worth a few
   * seconds at the end of a session, not a window that refuses to close.
   */
  async stopAll(timeoutMs = SHUTDOWN_WAIT_MS): Promise<void> {
    if (this.sizeTimer) clearInterval(this.sizeTimer)
    this.sizeTimer = null

    const jobs = [...this.jobs.values()]
    if (jobs.length === 0) return

    log.info(`finishing ${jobs.length} recording(s) before quitting`)
    for (const job of jobs) this.requestStop(job)

    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.all(jobs.map((job) => job.done)),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          log.warn('gave up waiting for a recording to finish')
          resolve()
        }, timeoutMs)
      })
    ])
    clearTimeout(timer)
  }

  private async spawn(recording: Recording): Promise<void> {
    if (recording.channelId === null) throw new Error('Recording has no channel')

    const provider = await resolveProviderStream({ type: 'channel', id: recording.channelId })
    const codecs = await probeStream(provider.url, {
      userAgent: provider.userAgent,
      referrer: provider.referrer
    })

    const directory = await this.outputDirectory()
    const extension = recordingContainer(codecs)
    const filePath = join(directory, `${safeName(recording)}.${extension}`)

    const durationSecs = Math.max(30, Math.round((recording.endsAt - Date.now()) / 1000))
    const args = buildRecordArgs(provider.url, filePath, codecs, {
      userAgent: provider.userAgent,
      referrer: provider.referrer,
      durationSecs
    })

    log.info(`recording ${recording.id} to ${filePath}`, redactArgs(args).slice(-6).join(' '))

    // stdin is a pipe so that `q` can be written to it; see `requestStop`.
    const child = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] })
    // ffmpeg exiting while the pipe is open raises EPIPE here, which is not an
    // error worth having: the process going away is the thing being waited for.
    child.stdin?.on('error', () => undefined)

    let settle: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
      settle = resolve
    })

    const job: ActiveJob = { recordingId: recording.id, child, filePath, stopping: false, done }
    this.jobs.set(recording.id, job)

    this.emit(
      repo.updateRecording(recording.id, {
        status: 'recording',
        filePath,
        startedAt: Date.now(),
        error: null
      })
    )

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })

    child.on('exit', (code, signal) => {
      this.jobs.delete(recording.id)
      void this.finalize(recording.id, filePath, code, signal, job.stopping, stderr).finally(settle)
    })

    child.on('error', (error) => {
      this.jobs.delete(recording.id)
      this.emit(
        repo.updateRecording(recording.id, {
          status: 'failed',
          error: errorMessage(error),
          finishedAt: Date.now()
        })
      )
      settle()
    })

    this.ensureSizePolling()
  }

  private async finalize(
    id: number,
    filePath: string,
    code: number | null,
    signal: NodeJS.Signals | null,
    stopping: boolean,
    stderr: string
  ): Promise<void> {
    let bytes = 0
    try {
      bytes = (await stat(filePath)).size
    } catch {
      // ffmpeg may have failed before writing anything.
    }

    /*
     * Bytes on disk are not a recording.
     *
     * This used to call anything `completed` that had been stopped and had a
     * non-zero size — which is exactly the file a hard kill leaves: a
     * multi-gigabyte MP4 with no index, that no player will open. The row said
     * the recording finished, the size looked right, and the user found out
     * weeks later.
     *
     * A clean exit is still taken at its word; that is the ordinary end of a
     * scheduled recording and the file is known good. Anything else — a stop,
     * a kill, a non-zero code — has to be opened before it is called a
     * recording. One ffprobe against a local file costs a few tens of
     * milliseconds, once, and is the only thing that actually answers the
     * question.
     */
    const clean = code === 0
    const playable = bytes > 0 && (clean || (await canBeOpened(filePath)))

    if (playable) {
      this.emit(repo.updateRecording(id, { status: 'completed', finishedAt: Date.now(), bytes }))
      log.info(
        `recording ${id} completed, ${(bytes / 1_048_576).toFixed(1)} MB` +
          (clean ? '' : ' (stopped early, and the file opens)')
      )
      return
    }

    const detail = stderr.trim().split('\n').slice(-2).join(' ').trim()
    const reason =
      bytes === 0
        ? 'The provider sent no data'
        : stopping || signal !== null
          ? 'The recording was cut off before the file could be finished, and it will not play'
          : detail || `ffmpeg exited with code ${code}`

    log.error(`recording ${id} failed`, reason)
    this.emit(
      repo.updateRecording(id, {
        status: 'failed',
        error: reason,
        finishedAt: Date.now(),
        bytes
      })
    )
  }

  /** Keeps the on-disk size fresh in the UI while a recording runs. */
  private ensureSizePolling(): void {
    if (this.sizeTimer) return

    this.sizeTimer = setInterval(() => {
      if (this.jobs.size === 0) {
        if (this.sizeTimer) clearInterval(this.sizeTimer)
        this.sizeTimer = null
        return
      }

      for (const job of this.jobs.values()) {
        void stat(job.filePath)
          .then((info) => this.emit(repo.updateRecording(job.recordingId, { bytes: info.size })))
          .catch(() => undefined)
      }
    }, 4000)
  }
}

/** Windows rejects several characters in file names, and very long names break tools. */
/**
 * The name a recording is saved under.
 *
 * The pattern belongs to the user; everything that makes it writable does
 * not. See `@shared/filename` — in particular the Windows device names, which
 * the function this replaces produced happily.
 */
function safeName(recording: Recording): string {
  return renderTemplate(getSettings().recordingTemplate, {
    channel: recording.channelName,
    title: recording.title,
    at: recording.startsAt
  })
}

/**
 * Whether a finished file can actually be opened.
 *
 * Deliberately not `probeStream`: that one caches, writes what it learns to
 * the database and is built around provider URLs that cost a connection. This
 * is a local file, asked about once, and the only thing wanted from it is
 * whether the container has a readable header — which is precisely what an
 * unfinished MP4 lacks.
 *
 * A missing ffprobe answers "yes". Refusing to believe in a recording because
 * the verifier is absent would turn a missing optional binary into lost
 * recordings, which is a worse failure than the one being guarded against.
 */
export async function canBeOpened(filePath: string): Promise<boolean> {
  const { ffprobe } = binaries()
  if (!ffprobe) return true

  return new Promise<boolean>((resolve) => {
    execFile(
      ffprobe,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ],
      { timeout: VERIFY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(false)
          return
        }
        try {
          const parsed = JSON.parse(stdout) as { streams?: unknown[] }
          resolve(Array.isArray(parsed.streams) && parsed.streams.length > 0)
        } catch {
          resolve(false)
        }
      }
    )
  })
}

export const recorder = new Recorder()
