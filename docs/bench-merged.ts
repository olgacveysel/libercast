/**
 * How long the all-sources merged list takes, at a catalogue size nobody
 * reaches by accident.
 *
 * Not part of `npm test`: it builds 150,000 channels, which takes a minute,
 * and a timing on a build machine measures the build machine. Kept because
 * the numbers in `claude/roadmap.md` came from it and should be reproducible.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron <bundled copy of this file>
 */
import { getDb, optimizeDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'

const WORDS = ['alto', 'harbour', 'civic', 'lumen', 'meridian', 'crest', 'vale', 'orion']
const PREFIX = ['TR |', 'DE |', 'UK |', '']
const QUAL = ['HD', 'FHD', '4K', '']
const cats = Array.from({ length: 60 }, (_, i) => ({ externalId: `cat${i}`, name: `Category ${i}` }))

const make = (n: number, source: number) =>
  Array.from({ length: n }, (_, i) => {
    const word = WORDS[(i + source) % WORDS.length]!
    return {
      externalId: `s${source}-${i}`,
      name: `${PREFIX[(i >> 5) % PREFIX.length]} ${word[0]!.toUpperCase()}${word.slice(1)} Sports ${i % 2000} ${QUAL[(i >> 2) % QUAL.length]}`.trim(),
      categoryExternalId: `cat${(i >> 6) % 60}`,
      number: i + 1,
      logoUrl: null,
      epgChannelId: `e${i}`,
      streamUrl: `http://p.invalid/${source}/${i}.ts`,
      containerExtension: 'ts',
      isAdult: false
    }
  })

const db = getDb()
for (let p = 0; p < 3; p++) {
  const playlist = createPlaylist({ name: `Source ${p}`, kind: 'm3u', url: `http://p.invalid/${p}` })
  importCatalog(playlist.id, 'live', cats, make(50_000, p))
}
optimizeDb()

const median = (fn: () => unknown, runs = 5): string => {
  fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const at = process.hrtime.bigint()
    fn()
    times.push(Number(process.hrtime.bigint() - at) / 1e6)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(runs / 2)]!.toFixed(0)
}

const merged = (extra: Record<string, unknown> = {}) =>
  ({ playlistId: null, kind: 'live', limit: 100, offset: 0, sort: 'name', merge: true, ...extra }) as never

console.log(`\n${(db.prepare("SELECT COUNT(*) n FROM channels").get() as { n: number }).n} channels across 3 providers\n`)
console.log('  first page       ', median(() => catalog.queryChannels(merged())), 'ms')
console.log('  count            ', median(() => catalog.countChannels(merged())), 'ms')
console.log('  deep page        ', median(() => catalog.queryChannels(merged({ offset: 5000 }))), 'ms')
console.log('  search           ', median(() => catalog.queryChannels(merged({ search: 'sports' }))), 'ms')
console.log('  one provider     ', median(() => catalog.queryChannels({ playlistId: 1, kind: 'live', limit: 100, offset: 0, sort: 'name' } as never)), 'ms')
console.log('  two-token search ', median(() => catalog.queryChannels(merged({ search: 'alto sports' }))), 'ms')
console.log('\n  before any of this: 480 / 164 / 480 / 580 / 0.5\n')
