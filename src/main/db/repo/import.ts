import type { ContentKind } from '@shared/types'
import { normalizedKey } from '@main/sources/epgMatch'
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
        epg_channel_id, stream_url, container_extension, is_adult, catchup_days, match_key,
        rating, year, provider_added_at,
        hidden, added_at, seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
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
       catchup_days = excluded.catchup_days,
       match_key = excluded.match_key,
       -- Only overwritten when the provider sent something. A panel that
       -- omits the rating on one sync must not erase the one it sent on the
       -- last, or a catalogue degrades a little every time it refreshes.
       rating = COALESCE(excluded.rating, channels.rating),
       year = COALESCE(excluded.year, channels.year),
       provider_added_at = COALESCE(excluded.provider_added_at, channels.provider_added_at),
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
        Math.max(0, Math.trunc(channel.catchupDays ?? 0)),
        // What the same channel on another provider will also normalise to.
        normalizedKey(channel.name),
        channel.rating ?? null,
        channel.year ?? null,
        channel.providerAddedAt ?? null,
        stamp,
        stamp
      )
    }

    /*
     * Episodes a portal already told us about.
     *
     * Only portals set this: they put a show's episode numbers on the listing
     * row, so the episodes arrive with the catalogue and there is no per-show
     * call to make. Xtream fetches its episodes lazily instead, when somebody
     * opens a show, and leaves this undefined.
     *
     * Written inside the same transaction as the channels they belong to, so
     * a sync that fails partway cannot leave a show whose episodes are from
     * the run before.
     */
    const withEpisodes = channels.filter((channel) => (channel.episodeNumbers?.length ?? 0) > 0)
    if (withEpisodes.length > 0) {
      const findChannel = db.prepare(
        'SELECT id FROM channels WHERE playlist_id = ? AND kind = ? AND external_id = ?'
      )
      const upsertEpisode = db.prepare(
        `INSERT INTO series_episodes
           (channel_id, external_id, season, episode, title, plot, duration_secs,
            container_extension, still_url)
         VALUES (?, ?, 1, ?, ?, NULL, NULL, NULL, NULL)
         ON CONFLICT(channel_id, external_id) DO UPDATE SET
           season = excluded.season,
           episode = excluded.episode,
           title = excluded.title`
      )
      const dropOthers = db.prepare(
        `DELETE FROM series_episodes
         WHERE channel_id = ?
           AND external_id NOT IN (SELECT value FROM json_each(?))`
      )

      for (const channel of withEpisodes) {
        const row = findChannel.get(playlistId, kind, channel.externalId) as { id: number } | undefined
        if (!row) continue

        const numbers = channel.episodeNumbers ?? []
        for (const number of numbers) {
          // A portal has no season dimension here — the number *is* the
          // episode, and it is also the identifier `create_link` is given, so
          // it is stored as the external id rather than renumbered.
          upsertEpisode.run(row.id, String(number), number, `Episode ${number}`)
        }
        // A show that lost episodes between syncs should lose them here too.
        dropOthers.run(row.id, JSON.stringify(numbers.map((number) => String(number))))
      }
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
