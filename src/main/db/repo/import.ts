import type { ContentKind } from '@shared/types'
import type { ParsedCategory, ParsedChannel } from '@main/sources/types'
import { fold, getDb } from '../index'

export interface ImportCounts {
  categories: number
  channels: number
  removed: number
}

/**
 * Replaces one content kind of a playlist's catalog in a single transaction.
 *
 * Rows are upserted rather than deleted and re-inserted so that channel ids stay
 * stable — favorites, history and progress reference them. Anything the provider
 * stopped returning is removed afterwards by comparing `seen_at`.
 *
 * The prune is scoped to `kind`. It must be: a sync calls this three times for
 * the same playlist (live, then movies, then series), and an unscoped delete
 * would make each pass wipe the previous one's rows.
 */
export function importCatalog(
  playlistId: number,
  kind: ContentKind,
  categories: ParsedCategory[],
  channels: ParsedChannel[]
): ImportCounts {
  const db = getDb()
  const stamp = Date.now()

  const upsertCategory = db.prepare(
    `INSERT INTO categories (playlist_id, external_id, name, kind, sort_order)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(playlist_id, kind, external_id) DO UPDATE SET
       name = excluded.name,
       sort_order = excluded.sort_order`
  )

  const findCategory = db.prepare(
    'SELECT id FROM categories WHERE playlist_id = ? AND kind = ? AND external_id = ?'
  )

  const upsertChannel = db.prepare(
    `INSERT INTO channels
       (playlist_id, category_id, external_id, kind, name, name_folded, number, logo_url,
        epg_channel_id, stream_url, container_extension, is_adult, hidden, added_at, seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(playlist_id, external_id) DO UPDATE SET
       category_id = excluded.category_id,
       kind = excluded.kind,
       name = excluded.name,
       name_folded = excluded.name_folded,
       number = excluded.number,
       logo_url = excluded.logo_url,
       epg_channel_id = excluded.epg_channel_id,
       stream_url = excluded.stream_url,
       container_extension = excluded.container_extension,
       is_adult = excluded.is_adult,
       seen_at = excluded.seen_at`
  )

  let removed = 0

  const run = db.transaction(() => {
    const categoryIds = new Map<string, number>()

    categories.forEach((category, index) => {
      upsertCategory.run(playlistId, category.externalId, category.name, kind, index)
      const row = findCategory.get(playlistId, kind, category.externalId) as { id: number } | undefined
      if (row) categoryIds.set(category.externalId, row.id)
    })

    for (const channel of channels) {
      const categoryId = channel.categoryExternalId ? categoryIds.get(channel.categoryExternalId) ?? null : null
      upsertChannel.run(
        playlistId,
        categoryId,
        channel.externalId,
        kind,
        channel.name,
        fold(channel.name),
        channel.number ?? null,
        channel.logoUrl ?? null,
        channel.epgChannelId ?? null,
        channel.streamUrl,
        channel.containerExtension ?? null,
        channel.isAdult ? 1 : 0,
        stamp,
        stamp
      )
    }

    // Stale rows: this playlist AND this kind, not touched by this import.
    const info = db
      .prepare('DELETE FROM channels WHERE playlist_id = ? AND kind = ? AND seen_at < ?')
      .run(playlistId, kind, stamp)
    removed = info.changes

    db.prepare(
      `DELETE FROM categories
       WHERE playlist_id = ? AND kind = ?
         AND external_id NOT IN (SELECT value FROM json_each(?))`
    ).run(playlistId, kind, JSON.stringify(categories.map((c) => c.externalId)))
  })

  run()

  return { categories: categories.length, channels: channels.length, removed }
}
