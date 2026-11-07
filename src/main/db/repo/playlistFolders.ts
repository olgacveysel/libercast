import type { PlaylistFolder } from '@shared/types'
import { getDb } from '../index'

interface FolderRow {
  id: number
  name: string
  sort_order: number
  collapsed: number
  created_at: number
}

function toFolder(row: FolderRow): PlaylistFolder {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    collapsed: row.collapsed === 1,
    createdAt: row.created_at
  }
}

/**
 * A name worth storing, or nothing.
 *
 * A folder called "   " is indistinguishable from an unnamed one in the
 * sidebar but is not equal to it anywhere else, so it is refused at the door
 * rather than left for the interface to render as a blank row.
 */
function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (trimmed === '') throw new Error('a folder needs a name')
  return trimmed.slice(0, 80)
}

export function listFolders(): PlaylistFolder[] {
  return getDb()
    .prepare('SELECT * FROM playlist_folders ORDER BY sort_order, id')
    .all()
    .map((r) => toFolder(r as FolderRow))
}

export function createFolder(name: string): PlaylistFolder {
  const db = getDb()
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM playlist_folders').get() as {
    n: number
  }

  const info = db
    .prepare('INSERT INTO playlist_folders (name, sort_order, collapsed, created_at) VALUES (?, ?, 0, ?)')
    .run(cleanName(name), next.n, Date.now())

  return getFolder(Number(info.lastInsertRowid))!
}

export function getFolder(id: number): PlaylistFolder | null {
  const row = getDb().prepare('SELECT * FROM playlist_folders WHERE id = ?').get(id) as FolderRow | undefined
  return row ? toFolder(row) : null
}

export function renameFolder(id: number, name: string): PlaylistFolder {
  getDb().prepare('UPDATE playlist_folders SET name = ? WHERE id = ?').run(cleanName(name), id)
  const folder = getFolder(id)
  if (!folder) throw new Error(`no folder ${id}`)
  return folder
}

export function setFolderCollapsed(id: number, collapsed: boolean): void {
  getDb().prepare('UPDATE playlist_folders SET collapsed = ? WHERE id = ?').run(collapsed ? 1 : 0, id)
}

/**
 * Deletes the folder, not what is in it.
 *
 * The schema says ON DELETE SET NULL, so the sources inside reappear in the
 * ungrouped list. This is spelled out here as well because it is the one
 * behaviour of this module somebody might change by accident, and the cost of
 * getting it wrong is a user losing configured providers — and the stored
 * credentials that go with them — by tidying up their sidebar.
 */
export function removeFolder(id: number): void {
  getDb().prepare('DELETE FROM playlist_folders WHERE id = ?').run(id)
}

/**
 * Rewrites the running order from a list of ids.
 *
 * Takes the whole order rather than a move, because the interface already
 * knows the arrangement it wants and reconstructing it from a sequence of
 * moves is how two reorders in quick succession end up disagreeing.
 *
 * Ids that no longer exist are ignored; anything the caller left out keeps its
 * place after the ones listed, so a stale list cannot silently bury a folder.
 */
export function reorderFolders(ids: number[]): PlaylistFolder[] {
  const db = getDb()
  const known = new Set(listFolders().map((f) => f.id))
  const ordered = ids.filter((id) => known.has(id))
  const rest = [...known].filter((id) => !ordered.includes(id))

  const update = db.prepare('UPDATE playlist_folders SET sort_order = ? WHERE id = ?')
  db.transaction(() => {
    ;[...ordered, ...rest].forEach((id, index) => update.run(index, id))
  })()

  return listFolders()
}
