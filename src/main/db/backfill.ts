import type Database from 'better-sqlite3'
import { normalizedKey } from '@main/sources/epgMatch'
import { createLogger } from '@main/util/logger'

const log = createLogger('db')

/**
 * Fills in match keys for channels imported before the column existed.
 *
 * The key is computed in JavaScript, so the migration that added the column
 * could not fill it — which would leave everything already on disk ungrouped
 * until the user happened to re-sync. Asking them to re-sync to get a feature
 * working is the kind of instruction nobody reads, so it is done here instead,
 * once, at startup.
 *
 * Cheap when there is nothing to do: the `WHERE match_key = ''` check is an
 * index lookup, and on a database that has already been backfilled it matches
 * no rows at all.
 */
export function backfillMatchKeys(db: Database.Database): void {
  const pending = db
    .prepare("SELECT id, name FROM channels WHERE match_key = ''")
    .all() as { id: number; name: string }[]

  if (pending.length === 0) return

  const update = db.prepare('UPDATE channels SET match_key = ? WHERE id = ?')
  db.transaction(() => {
    for (const row of pending) update.run(normalizedKey(row.name), row.id)
  })()

  log.info(`filled in match keys for ${pending.length} channels imported before they existed`)
}
