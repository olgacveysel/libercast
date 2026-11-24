/**
 * Walks the whole application and photographs it, against the real thing.
 *
 * Every screen is opened with the **real main process** behind it: the real
 * IPC handlers, the real repositories, a real database seeded with a
 * catalogue worth looking at. Nothing here answers on the application's
 * behalf.
 *
 * That matters more than it sounds. The first version of this tool hand-wrote
 * the answers, and guessed four shapes wrong — `state` for `status`, a
 * timestamp where a refresh report belonged, a nested object for a flat one,
 * a count under the wrong name. Every wrong guess looked exactly like a bug
 * in the screen; two cost a real investigation before turning out to be the
 * fixture's fault, and one screen could not be photographed at all. A review
 * tool whose findings are mostly its own mistakes is worse than none.
 *
 * Run it with:
 *
 *   node tools/walkthrough/run.mjs
 *
 * Screenshots land in tools/walkthrough/shots/ and are not committed.
 */
import { app, BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* A scratch database, so a walkthrough never touches a real installation. */
const scratch = mkdtempSync(join(tmpdir(), 'libercast-walk-'))
app.setPath('userData', scratch)

const root = process.cwd()
const OUT = join(root, 'tools', 'walkthrough', 'shots')

const WORDS = ['Alto', 'Harbour', 'Civic', 'Lumen', 'Crest', 'Vale', 'Orion']
const GROUPS = ['Sport', 'News', 'Cinema', 'Kids', 'Music', 'Docs']
const PREFIX = ['TR |', 'DE |', 'UK |', '']
const QUAL = ['HD', 'FHD', '4K', '']

const settle = (ms = 900): Promise<void> => new Promise((r) => setTimeout(r, ms))

function categories(kind: string): { externalId: string; name: string }[] {
  return GROUPS.map((group, i) => ({ externalId: `cat-${kind}-${i}`, name: group }))
}

function channels(kind: 'live' | 'movie' | 'series', source: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const word = WORDS[(i + source) % WORDS.length]!
    const group = GROUPS[(i >> 3) % GROUPS.length]!
    const name =
      kind === 'live'
        ? `${PREFIX[(i >> 4) % PREFIX.length]} ${word} ${group} ${(i % 30) + 1} ${QUAL[(i >> 1) % QUAL.length]}`.trim()
        : `${word} ${['Rising', 'Harbour', 'Lights', 'Dawn', 'Shadows'][i % 5]}`
    return {
      externalId: `${kind}-${source}-${i}`,
      name,
      categoryExternalId: `cat-${kind}-${(i >> 3) % GROUPS.length}`,
      number: kind === 'live' ? 100 + i : null,
      logoUrl: null,
      epgChannelId: kind === 'live' ? `ch${source}-${i}.tv` : null,
      streamUrl: `http://p.invalid/${kind}/${source}/${i}.ts`,
      containerExtension: kind === 'live' ? 'ts' : 'mp4',
      isAdult: false,
      catchupDays: kind === 'live' && i % 3 === 0 ? 7 : 0,
      rating: kind === 'live' || i % 7 === 0 ? null : 5 + (i % 50) / 10,
      year: kind === 'live' || i % 5 === 0 ? null : 2008 + (i % 18),
      providerAddedAt: kind === 'live' ? null : Date.now() - i * 86_400_000
    }
  })
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })

  /* Imported after userData is set, because opening the database uses it. */
  const { getDb } = await import('@main/db')
  const { registerIpcHandlers } = await import('@main/ipc')
  const { createPlaylist, markSynced } = await import('@main/db/repo/playlists')
  const { importCatalog } = await import('@main/db/repo/import')
  const { toggleFavorite, markWatched } = await import('@main/db/repo/catalog')
  const { saveProgress } = await import('@main/db/repo/vod')

  getDb()

  const panel = createPlaylist({ name: 'Main panel', kind: 'xtream', url: 'http://panel.invalid' })
  const list = createPlaylist({ name: 'Backup list', kind: 'm3u', url: 'http://list.invalid/pl.m3u' })
  const portal = createPlaylist({ name: 'Set-top portal', kind: 'stalker', url: 'http://portal.invalid/c/' })

  importCatalog(panel.id, 'live', categories('live'), channels('live', 0, 120))
  importCatalog(panel.id, 'movie', categories('movie'), channels('movie', 0, 48))
  importCatalog(panel.id, 'series', categories('series'), channels('series', 0, 18))
  importCatalog(list.id, 'live', categories('live'), channels('live', 1, 60))
  importCatalog(portal.id, 'live', categories('live'), channels('live', 2, 40))
  for (const playlist of [panel, list, portal]) markSynced(playlist.id)

  /* A little history and a few favourites, so the first screen is not empty. */
  const rows = getDb().prepare("SELECT id FROM channels WHERE kind = 'live' LIMIT 6").all() as { id: number }[]
  rows.slice(0, 3).forEach((row) => toggleFavorite(row.id))
  rows.forEach((row) => markWatched(row.id))
  const films = getDb().prepare("SELECT id FROM channels WHERE kind = 'movie' LIMIT 2").all() as { id: number }[]
  films.forEach((film, i) =>
    saveProgress({
      itemType: 'movie',
      itemId: film.id,
      channelId: film.id,
      positionSecs: 600 + i * 900,
      durationSecs: 5400
    })
  )

  registerIpcHandlers()

  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: true,
    webPreferences: { preload: join(root, 'out', 'preload', 'index.js'), sandbox: false }
  })
  await window.loadFile(join(root, 'out', 'renderer', 'index.html'))
  await settle(2500)

  const read = (script: string): Promise<never> => window.webContents.executeJavaScript(script) as Promise<never>

  const shoot = async (name: string): Promise<void> => {
    writeFileSync(join(OUT, `${name}.png`), (await window.capturePage()).toPNG())
    console.log(`  ${name}.png`)
  }

  const go = (label: string): string => `(() => {
    const item = [...document.querySelectorAll('.navitem')]
      .find((b) => b.textContent.trim() === ${JSON.stringify(label)})
    if (!item) return false
    item.click()
    return true
  })()`

  for (const [label, file] of [
    ['Home', '01-home'],
    ['Live TV', '02-live'],
    ['Guide', '03-guide'],
    ['Movies', '04-movies'],
    ['Series', '05-series'],
    ['Favorites', '06-favorites'],
    ['Multi-view', '07-multiview'],
    ['Library', '08-library'],
    ['Settings', '09-settings']
  ] as const) {
    if (!(await read(go(label)))) console.log(`  (no navigation item called ${label})`)
    await settle(1400)
    await shoot(file)
  }

  await read(go('Movies'))
  await settle(1000)
  await read(`document.querySelector('.poster')?.click()`)
  await settle(1200)
  await shoot('10-film-detail')

  /* Settings is the densest screen and the one the old fixture could not
     draw at all; its sections are discovered rather than guessed at. */
  await read(go('Settings'))
  await settle(1000)
  const sections = JSON.parse(
    await read(`JSON.stringify([...document.querySelectorAll('.settings__nav button, .settings nav button, [role="tab"]')].map((b) => b.textContent.trim()).filter(Boolean))`)
  ) as string[]
  console.log(`  settings sections: ${sections.join(', ') || '(none found)'}`)
  let n = 11
  for (const section of sections) {
    await read(`(() => {
      const el = [...document.querySelectorAll('.settings__nav button, .settings nav button, [role="tab"]')]
        .find((b) => b.textContent.trim() === ${JSON.stringify(section)})
      if (el) el.click()
      return !!el
    })()`)
    await settle(800)
    await shoot(`${n++}-settings-${section.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
  }

  console.log(`\nDatabase was ${scratch}`)
  app.exit(0)
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
