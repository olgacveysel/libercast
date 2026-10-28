import { getDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import * as parental from '@main/secure/parental'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const ch = (externalId: string, name: string) => ({
  externalId,
  name,
  categoryExternalId: null,
  number: null,
  logoUrl: null,
  epgChannelId: null,
  streamUrl: `http://x/${externalId}.ts`,
  containerExtension: 'ts',
  isAdult: false
})

getDb()

// Two providers, spelling the same channels differently — which is the normal
// case, not an awkward edge: no two panels name anything the same way.
const main = createPlaylist({ name: 'Main', kind: 'm3u', url: 'http://a' })
const backup = createPlaylist({ name: 'Backup', kind: 'm3u', url: 'http://b' })

importCatalog(main.id, 'live', [], [
  ch('a1', 'Alto Sports 2 HD'),
  ch('a2', 'Alto Sports 4 HD'),
  ch('a3', 'Civic One'),
  ch('a4', 'Only On Main'),
  ch('a5', '4K'),
  // The guard for prefix collapsing: a plain name with TWO differently
  // prefixed variants across the providers. Those are different feeds.
  ch('a6', 'Harbour Sports 2'),
  ch('a7', 'UK Harbour Sports 2'),
  // A prefix with nothing to collapse onto.
  ch('a8', 'FR Lumen Channel')
])
importCatalog(backup.id, 'live', [], [
  ch('b1', 'ALTO SPORTS 2'),
  ch('b2', 'TR | Alto Sports 2 (Hat 1)'),
  ch('b3', 'Civic One HD'),
  ch('b6', 'DE Harbour Sports 2'),
  ch('b4', 'Only On Backup'),
  ch('b5', '|||')
])

const merged = () =>
  catalog.queryChannels({ merge: true, kind: 'live', limit: 100, sort: 'name' })

console.log('\nOne list out of two providers')

const all = merged()
const names = all.map((c) => c.name)

// Two spellings of Alto 2 across two providers collapse to one row.
const alto2 = all.filter((c) => /alto/i.test(c.name) && c.name.includes('2') && !c.name.startsWith('TR'))
check('the same channel appears once', alto2.length === 1, names)
check('and reports both providers', alto2[0]?.sources === 2, alto2[0])

// A list prefix like "TR |" is how a provider sorts its own list, not part of
// what the channel is — so it collapses onto the unprefixed name when that
// name exists and nothing else claims it.
check('a list prefix collapses onto the plain name',
  !names.some((n) => n.startsWith('TR |')), names)

// The guard, and the reason this took two attempts: when two different
// prefixes point at the same plain name, they are different feeds. All three
// stay apart — merging them would be the same mistake as merging channel 2
// with channel 4.
const harbour = all.filter((c) => /harbour/i.test(c.name))
check('two different prefixes are never merged together', harbour.length === 3,
  harbour.map((c) => c.name))
check('and none of them is credited with a second source',
  harbour.every((c) => c.sources === 1), harbour.map((c) => `${c.name}:${c.sources}`))

// Nothing to collapse onto, so it keeps its prefix rather than losing it.
check('a prefix with no plain counterpart is left alone',
  names.some((n) => n === 'FR Lumen Channel'), names)

// The rule that matters most. Falling back onto the wrong match of the same
// competition is worse than showing no picture at all.
const alto4 = all.filter((c) => /alto/i.test(c.name) && c.name.includes('4'))
check('a different channel number stays its own row', alto4.length === 1, names)
check('and is not credited with a second source', alto4[0]?.sources === 1, alto4[0])

check('a quality suffix does not split a channel',
  all.filter((c) => /civic/i.test(c.name)).length === 1, names)
check('a channel only one provider has is still listed',
  names.some((n) => n === 'Only On Main') && names.some((n) => n === 'Only On Backup'), names)
check('and reports one provider',
  all.find((c) => c.name === 'Only On Backup')?.sources === 1)

// "4K" and "|||" normalise to nothing. Grouping on that would merge every
// such channel into a single row and lose the rest.
check('names that normalise to nothing are not merged together',
  names.filter((n) => n === '4K' || n === '|||').length === 2, names)

check('the count matches what the list returns',
  catalog.countChannels({ merge: true, kind: 'live' }) === all.length,
  { counted: catalog.countChannels({ merge: true, kind: 'live' }), listed: all.length })

console.log('\nWithout merging, nothing changes')

const single = catalog.queryChannels({ playlistId: main.id, kind: 'live', limit: 100 })
check('a single-source list is untouched', single.length === 8, single.length)
check('and every row reports one source', single.every((c) => c.sources === 1))

console.log('\nWhich copy represents the group')

const chosen = merged().find((c) => c.name.includes('2'))!
check('by default the higher-ordered source wins', chosen.playlistId === main.id, chosen)

// Starring the copy on the backup and then being shown the unstarred copy —
// which un-stars the other one when clicked — is how favourites come to feel
// broken.
const backupBein2 = catalog
  .queryChannels({ playlistId: backup.id, kind: 'live', limit: 50 })
  .find((c) => c.name === 'ALTO SPORTS 2')!
catalog.toggleFavorite(backupBein2.id)

const afterStar = merged().find((c) => c.name.includes('2') && /alto/i.test(c.name))!
check('a favourited copy becomes the one shown', afterStar.id === backupBein2.id, afterStar)
check('and the row reads as a favourite', afterStar.favorite === true, afterStar)
check('it still reports both providers', afterStar.sources === 2, afterStar)

check('a favourites-only merged list finds it',
  catalog.queryChannels({ merge: true, kind: 'live', favoritesOnly: true, limit: 50 }).length === 1)

catalog.toggleFavorite(backupBein2.id)

console.log('\nSearching across the merge')

const found = catalog.queryChannels({ merge: true, kind: 'live', search: 'alto', limit: 50 })
check('a search spans both providers', found.length === 2, found.map((c) => c.name))
check('and still collapses the duplicates',
  found.filter((c) => c.name === 'Alto Sports 2 HD').length === 1, found.map((c) => c.name))
check('searching finds the copy that was merged away',
  found.find((c) => c.name === 'Alto Sports 2 HD')?.sources === 2, found)

console.log('\nWhat must never leak through')

const mainBbc = catalog
  .queryChannels({ playlistId: main.id, kind: 'live', limit: 50 })
  .find((c) => c.name === 'Civic One')!
catalog.setHidden(mainBbc.id, true)

const hidden = merged()
check('a hidden copy is not shown', !hidden.some((c) => c.id === mainBbc.id), hidden.map((c) => c.name))
// The other provider still carries it, so the channel stays — with one source.
check('but the channel survives through the other provider',
  hidden.some((c) => c.name === 'Civic One HD'), hidden.map((c) => c.name))
check('and the source count drops to one',
  hidden.find((c) => c.name === 'Civic One HD')?.sources === 1)
catalog.setHidden(mainBbc.id, false)

// Parental filtering is applied in the query precisely so that no screen can
// forget to apply it — including this one.
parental.setPin(null, '1234')
parental.setRules({
  lockAdult: false,
  autoLockMinutes: 0,
  keywords: ['alto'],
  lockedCategoryIds: []
})
parental.lock()

const locked = merged()
check('a blocked word is filtered out of the merged list',
  !locked.some((c) => /alto/i.test(c.name)), locked.map((c) => c.name))
check('and the merged count agrees',
  catalog.countChannels({ merge: true, kind: 'live' }) === locked.length)

parental.unlock('1234')
parental.disable('1234')

console.log('\nA source the user switched off')

// Written straight to the column: the schema has carried `enabled` since v1
// and the queries honour it, but nothing in the interface sets it yet. Pinning
// it here means the merged list already behaves when something does.
const setEnabled = (id: number, on: boolean): void => {
  getDb().prepare('UPDATE playlists SET enabled = ? WHERE id = ?').run(on ? 1 : 0, id)
}

setEnabled(backup.id, false)
const withoutBackup = merged()
check('its channels leave the merged list',
  !withoutBackup.some((c) => c.name === 'Only On Backup'), withoutBackup.map((c) => c.name))
check('and nothing is credited to it any more',
  withoutBackup.every((c) => c.sources === 1), withoutBackup.map((c) => `${c.name}:${c.sources}`))
setEnabled(backup.id, true)

console.log('\nOpening a channel from the merged list')

const opened = catalog.getChannel(merged().find((c) => /alto/i.test(c.name) && c.name.includes('2'))!.id)
check('it knows it has a fallback', opened?.sources === 2, opened?.sources)
check('a channel with no counterpart knows that too',
  catalog.getChannel(merged().find((c) => c.name === 'Only On Main')!.id)?.sources === 1)


console.log('\nA catalogue the size of a real one')

// The merged query now does real work per group — reducing prefixes, deciding
// which of them may collapse — on the query behind every keystroke in the
// search box. A rule that is correct and unusably slow is not a rule anyone
// gets to keep, so the cost is measured rather than assumed.
const big = createPlaylist({ name: 'Big A', kind: 'm3u', url: 'http://big-a' })
const big2 = createPlaylist({ name: 'Big B', kind: 'm3u', url: 'http://big-b' })

const bulk = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ch(`${prefix}${i}`, `${prefix} Channel ${i}`))

importCatalog(big.id, 'live', [], bulk('x', 4000))
importCatalog(big2.id, 'live', [], bulk('y', 4000))

const started = Date.now()
const bigList = catalog.queryChannels({ merge: true, kind: 'live', limit: 500, sort: 'name' })
const listMs = Date.now() - started

const countStarted = Date.now()
const bigCount = catalog.countChannels({ merge: true, kind: 'live' })
const countMs = Date.now() - countStarted

check('eight thousand channels still merge', bigList.length === 500, bigList.length)
check('and the count agrees it is a big list', bigCount > 8000, bigCount)
// Generous on purpose: this is a floor against a collapse, not a benchmark.
check(`the list comes back quickly (${listMs}ms)`, listMs < 2000, listMs)
check(`and so does the count (${countMs}ms)`, countMs < 2000, countMs)

const searchStarted = Date.now()
catalog.queryChannels({ merge: true, kind: 'live', search: 'channel 123', limit: 100 })
const searchMs = Date.now() - searchStarted
check(`a search over all of it is quick too (${searchMs}ms)`, searchMs < 2000, searchMs)

console.log(failures === 0 ? '\nmerged: all passed' : `\nmerged: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
