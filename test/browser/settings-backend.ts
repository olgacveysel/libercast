/**
 * The real main process, for a harness that needs real answers.
 *
 * Most harnesses stand in for the bridge with a hand-written object, which is
 * right when the screen under test reads two or three things. Settings reads
 * most of the application, and a hand-written stand-in for it got four shapes
 * wrong before anybody noticed they were the fixture's fault rather than the
 * screen's — including one that stopped the screen rendering at all.
 *
 * So this gives the harness the actual repositories and the actual IPC
 * handlers, against a scratch database. Bundled by `tools/verify-all.mjs` the
 * way the stream server is for `verify-player`.
 */
import { app } from 'electron'
import { registerIpcHandlers } from '@main/ipc'
import { getDb } from '@main/db'
import { createPlaylist, markSynced } from '@main/db/repo/playlists'
import { importCatalog } from '@main/db/repo/import'

/** Opens a scratch database, fills it, and serves it over the real IPC. */
export function start(userDataDir: string): void {
  app.setPath('userData', userDataDir)
  getDb()

  const panel = createPlaylist({ name: 'Main panel', kind: 'xtream', url: 'http://panel.invalid' })
  const list = createPlaylist({ name: 'Backup list', kind: 'm3u', url: 'http://list.invalid/pl.m3u' })

  const channels = (source: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      externalId: `live-${source}-${i}`,
      name: `Alto Sport ${i + 1} HD`,
      categoryExternalId: 'cat-0',
      number: 100 + i,
      logoUrl: null,
      epgChannelId: `ch${source}-${i}.tv`,
      streamUrl: `http://p.invalid/${source}/${i}.ts`,
      containerExtension: 'ts',
      isAdult: false
    }))

  for (const playlist of [panel, list]) {
    importCatalog(playlist.id, 'live', [{ externalId: 'cat-0', name: 'Sport' }], channels(playlist.id, 20))
    markSynced(playlist.id)
  }

  registerIpcHandlers()
}
