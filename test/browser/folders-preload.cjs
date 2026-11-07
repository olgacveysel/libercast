/**
 * A bridge serving sources that are filed into folders.
 *
 * Four sources and two folders, arranged so that every case the sidebar has
 * to draw is present at once: a folder with sources in it, a folder that is
 * shut, a folder that is empty, and a source in no folder at all.
 *
 * The folder state is real rather than scripted — collapsing one here changes
 * what the next `folders:list` returns — because the thing being tested is
 * that the interface and the stored state agree after a click, not that a
 * click calls something.
 */
const { contextBridge } = require('electron')

const { defaults } = require('./settings-stub.cjs')

const settingsBase = {
  ...defaults(),
  // The source list lives under the navigation; nothing is visible with the
  // lists folded away.
  liveListsCollapsed: false,
  muted: true,
  volume: 0
}

let settings = { ...settingsBase }

let folders = [
  { id: 1, name: 'Living room', sortOrder: 0, collapsed: false, createdAt: 1 },
  { id: 2, name: 'Spare box', sortOrder: 1, collapsed: true, createdAt: 2 },
  { id: 3, name: 'Nothing here', sortOrder: 2, collapsed: false, createdAt: 3 }
]

function source(id, name, kind, folderId) {
  return {
    id,
    name,
    kind,
    folderId,
    url: 'http://example.invalid',
    filePath: null,
    username: null,
    macAddress: null,
    epgUrl: null,
    epgOffsetMinutes: 0,
    userAgent: null,
    referrer: null,
    enabled: true,
    sortOrder: id,
    lastSyncedAt: Date.now(),
    createdAt: Date.now(),
    serverTimezone: null
  }
}

let playlists = [
  source(1, 'Alpha provider', 'xtream', 1),
  source(2, 'Bravo provider', 'xtream', 1),
  source(3, 'Charlie list', 'm3u', 2),
  source(4, 'Delta portal', 'stalker', null),
  // Deliberately pointing at a folder that is not in the list above. Nothing
  // should be able to make a configured source disappear from the sidebar.
  source(5, 'Echo orphan', 'm3u', 99)
]

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => {
    settings = { ...settings, ...patch }
    return { ...settings }
  },
  'playlists:list': () => playlists.map((p) => ({ ...p })),
  'playlists:setFolder': ({ id, folderId }) => {
    playlists = playlists.map((p) => (p.id === id ? { ...p, folderId } : p))
    return { ...playlists.find((p) => p.id === id) }
  },
  'folders:list': () => folders.map((f) => ({ ...f })),
  'folders:collapse': ({ id, collapsed }) => {
    folders = folders.map((f) => (f.id === id ? { ...f, collapsed } : f))
    return undefined
  },
  'folders:create': (name) => {
    const folder = { id: folders.length + 1, name, sortOrder: folders.length, collapsed: false, createdAt: 9 }
    folders = [...folders, folder]
    return { ...folder }
  },
  'folders:remove': (id) => {
    folders = folders.filter((f) => f.id !== id)
    // What the schema's ON DELETE SET NULL does, mirrored here so the harness
    // exercises the behaviour the real thing has rather than a kinder one.
    playlists = playlists.map((p) => (p.folderId === id ? { ...p, folderId: null } : p))
    return undefined
  },
  'categories:list': () => [],
  'channels:query': () => [],
  'channels:count': () => 0,
  'channels:recent': () => [],
  'progress:continueWatching': () => [],
  'epg:forChannel': () => [],
  'media:capabilities': () => ({
    ffmpeg: true,
    ffmpegSource: 'bundled',
    ffprobe: true,
    recordingsPath: null
  }),
  'app:version': () => '0.9.0-test'
}

contextBridge.exposeInMainWorld('api', {
  invoke: (name, payload) => {
    if (!answers[name]) {
      console.error(`[folders-preload] no answer scripted for "${name}"`)
      return Promise.resolve(null)
    }
    return Promise.resolve(answers[name](payload))
  },
  on: () => () => undefined,
  platform: 'win32'
})
