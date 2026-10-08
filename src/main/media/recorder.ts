import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Recording, RecordingRequest } from '@shared/types'
import { getChannel } from '@main/db/repo/catalog'
import { getSettings } from '@main/db/repo/settings'
import * as repo from '@main/db/repo/recordings'
import { resolveProviderStream } from './resolve'
import { createLogger, errorMessage } from '@main/util/logger'
import { buildRecordArgs, recordingContainer, redactArgs } from './args'
import { ffmpegPath } from './binaries'
import { probeStream } from './probe'

const log = createLogger('recorder')

export type RecordingListener = (recording: Recording) => void

interface ActiveJob {
  recordingId: number
  child: ChildProcess
  filePath: string
  /** Set when the user asked to stop, so a clean exit is not reported as a failure. */
  stopping: boolean
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

    job.stopping = true
    // SIGINT lets ffmpeg finalize the container. SIGKILL would leave an MP4
    // with no moov atom, which nothing can play.
    job.child.kill('SIGINT')
    setTimeout(() => {
      if (this.jobs.has(recordingId)) job.child.kill('SIGKILL')
    }, 4000)

    return repo.getRecording(recordingId)
  }

  isRunning(recordingId: number): boolean {
    return this.jobs.has(recordingId)
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      job.stopping = true
      job.child.kill('SIGINT')
    }
    if (this.sizeTimer) clearInterval(this.sizeTimer)
    this.sizeTimer = null
  }

  private async spawn(recording: Recording): Promise<void> {
    if (recording.channelId === null) throw new Error('Recording has no channel')

    const provider = resolveProviderStream({ type: 'channel', id: recording.channelId })
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

    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const job: ActiveJob = { recordingId: recording.id, child, filePath, stopping: false }
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
      void this.finalize(recording.id, filePath, code, signal, job.stopping, stderr)
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

    // Exiting via -t or a user stop is a success as long as data reached disk.
    const succeeded = code === 0 || (stopping && bytes > 0) || (signal === 'SIGINT' && bytes > 0)

    if (succeeded && bytes > 0) {
      this.emit(repo.updateRecording(id, { status: 'completed', finishedAt: Date.now(), bytes }))
      log.info(`recording ${id} completed, ${(bytes / 1_048_576).toFixed(1)} MB`)
      return
    }

    const detail = stderr.trim().split('\n').slice(-2).join(' ').trim()
    this.emit(
      repo.updateRecording(id, {
        status: 'failed',
        error: detail || (bytes === 0 ? 'The provider sent no data' : `ffmpeg exited with code ${code}`),
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
export function safeFileName(channelName: string, title: string, startsAt: number): string {
  const stamp = new Date(startsAt).toISOString().slice(0, 16).replace('T', ' ').replace(':', '-')

  const clean = `${channelName} - ${title}`
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  return `${clean} (${stamp})`
}

function safeName(recording: Recording): string {
  return safeFileName(recording.channelName, recording.title, recording.startsAt)
}

export const recorder = new Recorder()
