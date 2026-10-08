import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import type { Download, DownloadRequest } from '@shared/types'
import { getChannel } from '@main/db/repo/catalog'
import * as repo from '@main/db/repo/downloads'
import { getSettings } from '@main/db/repo/settings'
import { getEpisode } from '@main/db/repo/vod'
import { buildHeaders } from '@main/util/http'
import { createLogger, errorMessage } from '@main/util/logger'
import { resolveProviderStream } from './resolve'

const log = createLogger('downloader')

export type DownloadListener = (download: Download) => void

/** Progress is written to the UI at most this often, not per chunk. */
const PROGRESS_INTERVAL_MS = 700

/** Rows are persisted less often than the UI updates, to spare the disk. */
const PERSIST_INTERVAL_MS = 4000

interface ActiveJob {
  id: number
  controller: AbortController
  filePath: string
  /** Set when the user paused, so an aborted request is not reported as failure. */
  paused: boolean
  /** Set when the user cancelled, so the partial file is deleted. */
  cancelled: boolean
}

/**
 * Downloads VOD titles for offline viewing.
 *
 * Unlike recording, this does not go through ffmpeg: a VOD item is already a
 * finished file on the provider's server, so a plain HTTP transfer produces a
 * byte-identical copy, costs no CPU, and — because providers support range
 * requests — can resume after a pause, a crash or a lost connection.
 */
class Downloader {
  private readonly jobs = new Map<number, ActiveJob>()
  private listener: DownloadListener | null = null
  private draining = false

  onChange(listener: DownloadListener): void {
    this.listener = listener
  }

  private emit(download: Download | null, speed?: number): void {
    if (download && this.listener) this.listener(speed === undefined ? download : { ...download, speed })
  }

  async outputDirectory(): Promise<string> {
    const configured = getSettings().downloadsPath
    const directory = configured ?? join(app.getPath('videos'), 'LiberCast', 'Downloads')
    await mkdir(directory, { recursive: true })
    return directory
  }

  /** Adds to the queue. The runner starts it when a slot frees up. */
  enqueue(request: DownloadRequest): Download {
    const channel = getChannel(request.channelId)
    if (!channel) throw new Error('Title not found')

    const download = repo.createDownload({
      itemType: request.itemType,
      itemId: request.itemId,
      channelId: channel.id,
      playlistId: channel.playlistId,
      title: request.title,
      subtitle: request.subtitle ?? null,
      posterUrl: request.posterUrl ?? channel.logoUrl
    })

    this.emit(download)
    void this.drain()
    return download
  }

  pause(id: number): Download | null {
    const job = this.jobs.get(id)
    if (job) {
      job.paused = true
      job.controller.abort()
      return repo.getDownload(id)
    }

    // Queued but not started yet.
    const updated = repo.updateDownload(id, { status: 'paused' })
    this.emit(updated)
    return updated
  }

  resume(id: number): Download | null {
    const updated = repo.updateDownload(id, { status: 'queued', error: null })
    this.emit(updated)
    void this.drain()
    return updated
  }

  cancel(id: number): Download | null {
    const job = this.jobs.get(id)
    if (job) {
      job.cancelled = true
      job.controller.abort()
      return repo.getDownload(id)
    }

    const download = repo.getDownload(id)
    if (download?.filePath) void rm(download.filePath, { force: true })

    const updated = repo.updateDownload(id, {
      status: 'cancelled',
      finishedAt: Date.now(),
      bytesDone: 0
    })
    this.emit(updated)
    return updated
  }

  async remove(id: number, deleteFile: boolean): Promise<void> {
    const download = repo.getDownload(id)
    if (this.jobs.has(id)) this.cancel(id)
    if (deleteFile && download?.filePath) await rm(download.filePath, { force: true })
    repo.removeDownload(id)
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      job.paused = true
      job.controller.abort()
    }
  }

  /** Recovers rows a crash left mid-flight, then starts anything queued. */
  start(): void {
    const recovered = repo.reconcileOnStartup()
    if (recovered > 0) log.info(`${recovered} download(s) paused after an unclean shutdown`)
    void this.drain()
  }

  /**
   * Starts queued downloads until the concurrency limit is reached.
   *
   * The limit defaults to one on purpose: a download holds a provider
   * connection, and most Xtream accounts allow very few, so a parallel download
   * would stop the user watching anything.
   */
  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true

    try {
      const limit = Math.max(1, getSettings().maxConcurrentDownloads)
      let slots = limit - this.jobs.size
      if (slots <= 0) return

      for (const download of repo.nextQueued(slots)) {
        if (this.jobs.has(download.id)) continue
        slots -= 1
        void this.run(download)
        if (slots <= 0) break
      }
    } finally {
      this.draining = false
    }
  }

  private async run(download: Download): Promise<void> {
    const controller = new AbortController()

    let filePath = download.filePath
    let startAt = 0

    try {
      const provider = resolveProviderStream(
        download.itemType === 'episode'
          ? { type: 'episode', id: download.itemId }
          : { type: 'channel', id: download.itemId }
      )

      if (!filePath) {
        const directory = await this.outputDirectory()
        filePath = join(directory, fileNameFor(download, provider.url))
      }

      // A partial file from an earlier attempt is the resume point.
      startAt = await sizeOf(filePath)

      const job: ActiveJob = { id: download.id, controller, filePath, paused: false, cancelled: false }
      this.jobs.set(download.id, job)

      this.emit(
        repo.updateDownload(download.id, {
          status: 'downloading',
          filePath,
          error: null,
          bytesDone: startAt
        })
      )

      const headers = buildHeaders({ userAgent: provider.userAgent, referrer: provider.referrer })
      if (startAt > 0) headers['Range'] = `bytes=${startAt}-`

      const response = await fetch(provider.url, { headers, signal: controller.signal })

      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`)
      if (!response.body) throw new Error('Provider sent an empty response')

      // 206 means the range was honoured. A 200 in reply to a range request
      // means the server ignored it and is resending from the start, so the
      // partial file has to be discarded rather than appended to.
      const resumed = startAt > 0 && response.status === 206
      if (startAt > 0 && !resumed) {
        log.warn(`provider ignored the range request for download ${download.id}; restarting`)
        startAt = 0
      }

      const contentLength = Number(response.headers.get('content-length') ?? '0')
      const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength + startAt : 0
      if (total > 0) repo.updateDownload(download.id, { bytesTotal: total })

      await this.transfer(job, response.body, startAt, total)

      const finalSize = await sizeOf(filePath)
      this.emit(
        repo.updateDownload(download.id, {
          status: 'completed',
          bytesDone: finalSize,
          bytesTotal: finalSize,
          finishedAt: Date.now()
        })
      )
      log.info(`download ${download.id} completed, ${(finalSize / 1_048_576).toFixed(1)} MB`)
    } catch (error) {
      const job = this.jobs.get(download.id)
      const done = filePath ? await sizeOf(filePath) : 0

      if (job?.cancelled) {
        if (filePath) await rm(filePath, { force: true })
        this.emit(
          repo.updateDownload(download.id, {
            status: 'cancelled',
            bytesDone: 0,
            finishedAt: Date.now()
          })
        )
      } else if (job?.paused) {
        // The partial file stays; resuming picks up from its length.
        this.emit(repo.updateDownload(download.id, { status: 'paused', bytesDone: done }))
      } else {
        const message = errorMessage(error)
        log.error(`download ${download.id} failed`, message)
        this.emit(
          repo.updateDownload(download.id, {
            status: 'failed',
            error: message,
            bytesDone: done,
            finishedAt: Date.now()
          })
        )
      }
    } finally {
      this.jobs.delete(download.id)
      void this.drain()
    }
  }

  private async transfer(
    job: ActiveJob,
    body: ReadableStream<Uint8Array>,
    startAt: number,
    total: number
  ): Promise<void> {
    // Appending when resuming, truncating when starting over.
    const sink = createWriteStream(job.filePath, { flags: startAt > 0 ? 'a' : 'w' })

    let done = startAt
    let lastEmit = 0
    let lastPersist = Date.now()
    let windowBytes = 0
    let windowStart = Date.now()

    const source = Readable.fromWeb(body as never)

    source.on('data', (chunk: Buffer) => {
      done += chunk.length
      windowBytes += chunk.length

      const now = Date.now()
      if (now - lastEmit < PROGRESS_INTERVAL_MS) return

      const speed = windowBytes / ((now - windowStart) / 1000 || 1)
      lastEmit = now
      windowBytes = 0
      windowStart = now

      // The UI updates from this in-memory value; the row is written far less
      // often, because a multi-gigabyte download would otherwise mean thousands
      // of pointless writes.
      const persist = now - lastPersist > PERSIST_INTERVAL_MS
      if (persist) lastPersist = now

      const row = persist
        ? repo.updateDownload(job.id, { bytesDone: done })
        : { ...(repo.getDownload(job.id) as Download), bytesDone: done, bytesTotal: total }

      this.emit(row, speed)
    })

    await pipeline(source, sink)
  }
}

async function sizeOf(path: string | null): Promise<number> {
  if (!path) return 0
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/** Windows rejects several characters in file names, and long names break tools. */
export function safeFileName(title: string, subtitle: string | null, extension: string): string {
  const base = [title, subtitle].filter(Boolean).join(' - ')
  const clean = base
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)

  return `${clean || 'Download'}.${extension}`
}

export function extensionFor(url: string): string {
  const match = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url)
  return match ? match[1]!.toLowerCase() : 'mp4'
}

function fileNameFor(download: Download, url: string): string {
  // Episodes carry their series name in `title` and the episode in `subtitle`,
  // which together make a name that sorts sensibly in a file manager.
  const episode = download.itemType === 'episode' ? getEpisode(download.itemId) : null
  const subtitle =
    download.subtitle ??
    (episode ? `S${pad(episode.season)}E${pad(episode.episode)} ${episode.title}` : null)

  return safeFileName(download.title, subtitle, extensionFor(url))
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export const downloader = new Downloader()
