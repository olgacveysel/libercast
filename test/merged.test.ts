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
  ch('a1', 'beIN Sports 2 HD'),
  ch('a2', 'beIN Sports 4 HD'),
  ch('a3', 'BBC One'),
  ch('a4', 'Only On Main'),
  ch('a5', '4K')
])
importCatalog(backup.id, 'live', [], [
  ch('b1', 'BEIN SPORTS 2'),
  ch('b2', 'TR | beIN Sports 2 (Hat 1)'),
  ch('b3', 'BBC One HD'),
  ch('b4', 'Only On Backup'),
  ch('b5', '|||')
])

const merged = () =>
  catalog.queryChannels({ merge: true, kind: 'live', limit: 100, sort: 'name' })

console.log('\nOne list out of two providers')

const all = merged()
const names = all.map((c) => c.name)

// Two spellings of beIN 2 across two providers collapse to one row.
const bein2 = all.filter((c) => /bein/i.test(c.name) && c.name.includes('2') && !c.name.startsWith('TR'))
check('the same channel appears once', bein2.length === 1, names)
check('and reports both providers', bein2[0]?.sources === 2, bein2[0])

// Deliberately NOT merged, and worth pinning so nobody "fixes" it later: a
// list prefix like "TR |" is indistinguishable, from here, from a feed
// marker. Stripping it would merge "UK Sky Sports 2" with "DE Sky Sports 2",
// which are different channels — the same class of mistake as merging beIN 2
// with beIN 4, and the one this whole feature is built to avoid.
check('a channel carrying a list prefix stays separate',
  names.some((n) => n.startsWith('TR |')), names)

// The rule that matters most. Falling back onto the wrong match of the same
// competition is worse than showing no picture at all.
const bein4 = all.filter((c) => /bein/i.test(c.name) && c.name.includes('4'))
check('a different channel number stays its own row', bein4.length === 1, names)
check('and is not credited with a second source', bein4[0]?.sources === 1, bein4[0])

check('a quality suffix does not split a channel',
  all.filter((c) => /bbc/i.test(c.name)).length === 1, names)
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
check('a single-source list is untouched', single.length === 5, single.length)
check('and every row reports one source', single.every((c) => c.sources === 1))

console.log('\nWhich copy represents the group')

const chosen = merged().find((c) => c.name.includes('2'))!
check('by default the higher-ordered source wins', chosen.playlistId === main.id, chosen)

// Starring the copy on the backup and then being shown the unstarred copy —
// which un-stars the other one when clicked — is how favourites come to feel
// broken.
const backupBein2 = catalog
  .queryChannels({ playlistId: backup.id, kind: 'live', limit: 50 })
  .find((c) => c.name === 'BEIN SPORTS 2')!
catalog.toggleFavorite(backupBein2.id)

const afterStar = merged().find((c) => c.name.includes('2') && /bein/i.test(c.name))!
check('a favourited copy becomes the one shown', afterStar.id === backupBein2.id, afterStar)
check('and the row reads as a favourite', afterStar.favorite === true, afterStar)
check('it still reports both providers', afterStar.sources === 2, afterStar)

check('a favourites-only merged list finds it',
  catalog.queryChannels({ merge: true, kind: 'live', favoritesOnly: true, limit: 50 }).length === 1)

catalog.toggleFavorite(backupBein2.id)

console.log('\nSearching across the merge')

const found = catalog.queryChannels({ merge: true, kind: 'live', search: 'bein', limit: 50 })
check('a search spans both providers', found.length === 3, found.map((c) => c.name))
check('and still collapses the duplicates',
  found.filter((c) => c.name === 'beIN Sports 2 HD').length === 1, found.map((c) => c.name))
check('searching finds the copy that was merged away',
  found.find((c) => c.name === 'beIN Sports 2 HD')?.sources === 2, found)

console.log('\nWhat must never leak through')

const mainBbc = catalog
  .queryChannels({ playlistId: main.id, kind: 'live', limit: 50 })
  .find((c) => c.name === 'BBC One')!
catalog.setHidden(mainBbc.id, true)

const hidden = merged()
check('a hidden copy is not shown', !hidden.some((c) => c.id === mainBbc.id), hidden.map((c) => c.name))
// The other provider still carries it, so the channel stays — with one source.
check('but the channel survives through the other provider',
  hidden.some((c) => c.name === 'BBC One HD'), hidden.map((c) => c.name))
check('and the source count drops to one',
  hidden.find((c) => c.name === 'BBC One HD')?.sources === 1)
catalog.setHidden(mainBbc.id, false)

// Parental filtering is applied in the query precisely so that no screen can
// forget to apply it — including this one.
parental.setPin(null, '1234')
parental.setRules({
  lockAdult: false,
  autoLockMinutes: 0,
  keywords: ['bein'],
  lockedCategoryIds: []
})
parental.lock()

const locked = merged()
check('a blocked word is filtered out of the merged list',
  !locked.some((c) => /bein/i.test(c.name)), locked.map((c) => c.name))
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

const opened = catalog.getChannel(merged().find((c) => /bein/i.test(c.name) && c.name.includes('2'))!.id)
check('it knows it has a fallback', opened?.sources === 2, opened?.sources)
check('a channel with no counterpart knows that too',
  catalog.getChannel(merged().find((c) => c.name === 'Only On Main')!.id)?.sources === 1)

console.log(failures === 0 ? '\nmerged: all passed' : `\nmerged: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
