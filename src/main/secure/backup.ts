import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import type { BackupOptions, BackupSummary, RestoreOptions, RestoreSummary } from '@shared/types'
import { getDb } from '@main/db'
import { getSettings, setSettings } from '@main/db/repo/settings'
import { getPassword, setPassword } from './credentials'
import { createLogger } from '@main/util/logger'

const log = createLogger('backup')

const FORMAT = 'libercast-backup'
const VERSION = 1

interface BackupPlaylist {
  name: string
  kind: string
  url: string
  filePath: string | null
  username: string | null
  macAddress: string | null
  epgUrl: string | null
  epgOffsetMinutes: number
  userAgent: string | null
  referrer: string | null
  sortOrder: number
  /** Present only when the user asked to include credentials. */
  password?: string
}

/**
 * A favorite or history entry refers to a channel by provider identity rather
 * than by row id, because restoring into a fresh database — or one synced in a
 * different order — assigns entirely different ids.
 */
interface BackupChannelRef {
  playlist: string
  externalId: string
}

interface BackupProgress extends BackupChannelRef {
  itemType: string
  /** Episodes are identified by their provider id, for the same reason. */
  episodeExternalId: string | null
  positionSecs: number
  durationSecs: number
  completed: boolean
  updatedAt: number
}

interface BackupPayload {
  format: typeof FORMAT
  version: number
  exportedAt: number
  playlists: BackupPlaylist[]
  favorites: BackupChannelRef[]
  history: (BackupChannelRef & { lastWatchedAt: number; watchCount: number })[]
  progress: BackupProgress[]
  settings: Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/* Encryption                                                          */
/* ------------------------------------------------------------------ */

interface Envelope {
  format: typeof FORMAT
  encrypted: true
  salt: string
  iv: string
  tag: string
  data: string
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize('NFKC'), salt, 32, { N: 16384, r: 8, p: 1 })
}

export function encryptPayload(json: string, passphrase: string): Envelope {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)

  const data = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])

  return {
    format: FORMAT,
    encrypted: true,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
}

export function decryptPayload(envelope: Envelope, passphrase: string): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(passphrase, Buffer.from(envelope.salt, 'base64')),
    Buffer.from(envelope.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    // GCM authentication failing means either the wrong passphrase or a
    // tampered file; the user only needs to know the first.
    throw new Error('That passphrase does not open this backup')
  }
}

export function isEncrypted(parsed: unknown): parsed is Envelope {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { encrypted?: unknown }).encrypted === true
  )
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function buildPayload(includeCredentials: boolean): BackupPayload {
  const db = getDb()

  const playlistRows = db.prepare('SELECT * FROM playlists ORDER BY sort_order').all() as Record<
    string,
    unknown
  >[]

  const playlists: BackupPlaylist[] = playlistRows.map((row) => {
    const entry: BackupPlaylist = {
      name: String(row.name),
      kind: String(row.kind),
      url: String(row.url),
      filePath: (row.file_path as string) ?? null,
      username: (row.username as string) ?? null,
      macAddress: (row.mac_address as string) ?? null,
      epgUrl: (row.epg_url as string) ?? null,
      epgOffsetMinutes: Number(row.epg_offset_min ?? 0),
      userAgent: (row.user_agent as string) ?? null,
      referrer: (row.referrer as string) ?? null,
      sortOrder: Number(row.sort_order ?? 0)
    }

    if (includeCredentials) {
      const password = getPassword(Number(row.id))
      if (password) entry.password = password
    }

    return entry
  })

  const favorites = db
    .prepare(
      `SELECT p.name AS playlist, ch.external_id AS externalId
       FROM favorites f
       JOIN channels ch ON ch.id = f.channel_id
       JOIN playlists p ON p.id = ch.playlist_id`
    )
    .all() as BackupChannelRef[]

  const history = db
    .prepare(
      `SELECT p.name AS playlist, ch.external_id AS externalId,
              h.last_watched_at AS lastWatchedAt, h.watch_count AS watchCount
       FROM watch_history h
       JOIN channels ch ON ch.id = h.channel_id
       JOIN playlists p ON p.id = ch.playlist_id`
    )
    .all() as BackupPayload['history']

  const progress = db
    .prepare(
      `SELECT pr.item_type AS itemType, pr.position_secs AS positionSecs,
              pr.duration_secs AS durationSecs, pr.completed AS completed,
              pr.updated_at AS updatedAt,
              p.name AS playlist, ch.external_id AS externalId,
              e.external_id AS episodeExternalId
       FROM playback_progress pr
       JOIN channels ch ON ch.id = pr.channel_id
       JOIN playlists p ON p.id = ch.playlist_id
       LEFT JOIN series_episodes e ON pr.item_type = 'episode' AND e.id = pr.item_id`
    )
    .all()
    .map((row) => {
      const r = row as Record<string, unknown>
      return {
        itemType: String(r.itemType),
        playlist: String(r.playlist),
        externalId: String(r.externalId),
        episodeExternalId: (r.episodeExternalId as string) ?? null,
        positionSecs: Number(r.positionSecs),
        durationSecs: Number(r.durationSecs),
        completed: r.completed === 1,
        updatedAt: Number(r.updatedAt)
      }
    })

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    playlists,
    favorites,
    history,
    progress,
    settings: getSettings() as unknown as Record<string, unknown>
  }
}

export async function exportBackup(filePath: string, options: BackupOptions): Promise<BackupSummary> {
  if (options.includeCredentials && !options.passphrase) {
    throw new Error('A passphrase is required when the backup includes provider passwords')
  }

  const payload = buildPayload(options.includeCredentials)
  const json = JSON.stringify(payload, null, options.passphrase ? 0 : 2)

  const output = options.passphrase
    ? JSON.stringify(encryptPayload(json, options.passphrase))
    : json

  await writeFile(filePath, output, 'utf8')
  const { size } = await stat(filePath)

  log.info(`exported backup to ${filePath} (${size} bytes)`)

  return {
    filePath,
    playlists: payload.playlists.length,
    favorites: payload.favorites.length,
    history: payload.history.length,
    progress: payload.progress.length,
    encrypted: Boolean(options.passphrase),
    bytes: size
  }
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export async function readBackup(filePath: string, passphrase?: string): Promise<BackupPayload> {
  const raw = await readFile(filePath, 'utf8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('That file is not a LiberCast backup')
  }

  if (isEncrypted(parsed)) {
    if (!passphrase) throw new Error('This backup is encrypted. Enter its passphrase to continue.')
    parsed = JSON.parse(decryptPayload(parsed, passphrase))
  }

  const payload = parsed as BackupPayload
  if (payload.format !== FORMAT) throw new Error('That file is not a LiberCast backup')
  if (payload.version > VERSION) {
    throw new Error('That backup was made by a newer version of LiberCast')
  }

  return payload
}

export async function importBackup(options: RestoreOptions): Promise<RestoreSummary> {
  const payload = await readBackup(options.filePath, options.passphrase)
  const db = getDb()

  const summary: RestoreSummary = {
    playlists: 0,
    favorites: 0,
    history: 0,
    progress: 0,
    settingsRestored: false,
    needCredentials: []
  }

  const run = db.transaction(() => {
    if (options.mode === 'replace') {
      // Cascades clear channels, favorites, history and progress with them.
      db.prepare('DELETE FROM playlists').run()
    }

    const findPlaylist = db.prepare('SELECT id FROM playlists WHERE name = ?')
    const insertPlaylist = db.prepare(
      `INSERT INTO playlists
         (name, kind, url, file_path, username, mac_address, epg_url, epg_offset_min,
          user_agent, referrer, enabled, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )

    const playlistIds = new Map<string, number>()

    for (const playlist of payload.playlists) {
      const existing = findPlaylist.get(playlist.name) as { id: number } | undefined

      let id: number
      if (existing) {
        // Merging must not duplicate a source the user already has.
        id = existing.id
      } else {
        const info = insertPlaylist.run(
          playlist.name,
          playlist.kind,
          playlist.url,
          playlist.filePath,
          playlist.username,
          playlist.macAddress,
          playlist.epgUrl,
          playlist.epgOffsetMinutes,
          playlist.userAgent,
          playlist.referrer,
          playlist.sortOrder,
          Date.now()
        )
        id = Number(info.lastInsertRowid)
        summary.playlists += 1
      }

      playlistIds.set(playlist.name, id)

      if (playlist.password) {
        setPassword(id, playlist.password)
      } else if (playlist.kind === 'xtream' && !getPassword(id)) {
        summary.needCredentials.push(playlist.name)
      }
    }

    // Favorites, history and progress can only be reattached to channels that
    // exist, which means after a sync. Rows for channels that are not there yet
    // are skipped rather than guessed at.
    const findChannel = db.prepare(
      'SELECT id, category_id, is_adult, name FROM channels WHERE playlist_id = ? AND external_id = ?'
    )

    const addFavorite = db.prepare(
      'INSERT OR IGNORE INTO favorites (channel_id, added_at) VALUES (?, ?)'
    )
    for (const favorite of payload.favorites) {
      const playlistId = playlistIds.get(favorite.playlist)
      if (!playlistId) continue
      const channel = findChannel.get(playlistId, favorite.externalId) as { id: number } | undefined
      if (!channel) continue
      addFavorite.run(channel.id, Date.now())
      summary.favorites += 1
    }

    const addHistory = db.prepare(
      `INSERT INTO watch_history (channel_id, last_watched_at, watch_count)
       VALUES (?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         last_watched_at = MAX(last_watched_at, excluded.last_watched_at),
         watch_count = watch_count + excluded.watch_count`
    )
    for (const entry of payload.history) {
      const playlistId = playlistIds.get(entry.playlist)
      if (!playlistId) continue
      const channel = findChannel.get(playlistId, entry.externalId) as { id: number } | undefined
      if (!channel) continue
      addHistory.run(channel.id, entry.lastWatchedAt, entry.watchCount)
      summary.history += 1
    }

    const findEpisode = db.prepare(
      'SELECT id FROM series_episodes WHERE channel_id = ? AND external_id = ?'
    )
    const addProgress = db.prepare(
      `INSERT INTO playback_progress
         (item_type, item_id, channel_id, position_secs, duration_secs, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_type, item_id) DO UPDATE SET
         position_secs = excluded.position_secs,
         duration_secs = excluded.duration_secs,
         completed = excluded.completed,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at > playback_progress.updated_at`
    )

    for (const entry of payload.progress) {
      const playlistId = playlistIds.get(entry.playlist)
      if (!playlistId) continue
      const channel = findChannel.get(playlistId, entry.externalId) as { id: number } | undefined
      if (!channel) continue

      let itemId = channel.id
      if (entry.itemType === 'episode') {
        if (!entry.episodeExternalId) continue
        const episode = findEpisode.get(channel.id, entry.episodeExternalId) as
          | { id: number }
          | undefined
        if (!episode) continue
        itemId = episode.id
      }

      addProgress.run(
        entry.itemType,
        itemId,
        channel.id,
        entry.positionSecs,
        entry.durationSecs,
        entry.completed ? 1 : 0,
        entry.updatedAt
      )
      summary.progress += 1
    }
  })

  run()

  if (payload.settings) {
    // Paths and the ffmpeg override belong to the machine that made the backup,
    // so they are left alone rather than pointing at folders that may not exist.
    const { recordingsPath, downloadsPath, ffmpegPath, ...portable } = payload.settings
    void recordingsPath
    void downloadsPath
    void ffmpegPath
    setSettings(portable)
    summary.settingsRestored = true
  }

  log.info(
    `restored ${summary.playlists} playlists, ${summary.favorites} favorites, ${summary.progress} progress entries`
  )

  return summary
}
