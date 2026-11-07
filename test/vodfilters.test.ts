import { getDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import { vodAddedAt, vodRating, vodYear } from '@main/sources/vodMeta'

/**
 * Filtering and sorting a film catalogue.
 *
 * The data these rely on comes from the provider's *list* response, which the
 * parser used to read five fields of and discard the rest. So the first half
 * of this file is about reading it correctly — panels send ratings on two
 * different scales and years in four different places — and the second half
 * is about the query, which has to put "the provider did not say" somewhere
 * sensible rather than treating it as zero.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nReading a rating off a panel')

check('a ten-point rating is kept', vodRating('7.4', null) === 7.4)
check('a number rather than a string works too', vodRating(7.4, null) === 7.4)
// The giveaway that `rating` is on the 5-point scale is the panel sending the
// same value in the field that says so.
check('a five-point rating is doubled', vodRating('4.1', '4.1') === 8.2)
check('a five-based field alone is doubled', vodRating(null, '3.5') === 7)
check('ten-point and five-based together keep the ten-point one',
  vodRating('8.6', '4.3') === 8.6, vodRating('8.6', '4.3'))
check('nothing is null, not zero', vodRating(null, null) === null)
check('an empty string is null', vodRating('', '') === null)
check('zero is null, because no panel means "rated zero"', vodRating('0', null) === null)
check('nonsense is null', vodRating('N/A', null) === null)
check('a rating beyond the scale is refused', vodRating('99', null) === null)

console.log('\nFinding a year')

check('a year field is used', vodYear('1994') === 1994)
check('a year inside a date is found', vodYear(null, '1994-10-14') === 1994)
check('and at the end of one', vodYear(null, '14 October 1999') === 1999)
check('the first source that has one wins', vodYear(null, '2001-01-01', '1999') === 2001)
check('a number works', vodYear(2015) === 2015)
check('a runtime is not a year', vodYear('142') === null)
check('nothing is null', vodYear(null, undefined, '') === null)
check('an implausible year is refused', vodYear('1066') === null)

console.log('\nWhen the provider added it')

check('unix seconds become milliseconds', vodAddedAt('1700000000') === 1700000000000)
check('milliseconds are left alone', vodAddedAt(1700000000000) === 1700000000000)
check('zero is null', vodAddedAt('0') === null)
check('nothing is null', vodAddedAt(null) === null)

console.log('\nFiltering a catalogue')

getDb()
const source = createPlaylist({ name: 'Films', kind: 'm3u', url: 'http://m3u/films' })

const film = (
  id: string,
  name: string,
  rating: number | null,
  year: number | null,
  added: number | null
) => ({
  externalId: `vod:${id}`,
  name,
  categoryExternalId: null,
  number: null,
  logoUrl: null,
  epgChannelId: null,
  streamUrl: `http://x/${id}.mp4`,
  containerExtension: 'mp4',
  isAdult: false,
  rating,
  year,
  providerAddedAt: added
})

importCatalog(source.id, 'movie', [], [
  film('1', 'Alpha', 8.5, 2021, 3000),
  film('2', 'Bravo', 6.0, 1998, 5000),
  film('3', 'Charlie', 9.1, 2015, 1000),
  // The common case on a real panel: no metadata at all.
  film('4', 'Delta', null, null, null),
  film('5', 'Echo', 7.0, 2021, 4000)
])

const names = (query: Parameters<typeof catalog.queryChannels>[0]): string[] =>
  catalog.queryChannels(query).map((row) => row.name)

const base = { playlistId: source.id, kind: 'movie' as const, limit: 50 }

check('everything is listed by default', names(base).length === 5, names(base))
check('the metadata survives the import',
  catalog.queryChannels(base).find((r) => r.name === 'Alpha')?.rating === 8.5)
check('and a title without it has null, not zero',
  catalog.queryChannels(base).find((r) => r.name === 'Delta')?.rating === null)

console.log('\nSorting')

check('by name', names({ ...base, sort: 'name' }).join(',') === 'Alpha,Bravo,Charlie,Delta,Echo',
  names({ ...base, sort: 'name' }))
check('by rating, best first',
  names({ ...base, sort: 'rating' }).slice(0, 3).join(',') === 'Charlie,Alpha,Echo',
  names({ ...base, sort: 'rating' }))
// The point of the IS NULL clause: an unrated film is not the worst film.
check('an unrated title sorts last rather than bottom of the ranking',
  names({ ...base, sort: 'rating' })[4] === 'Delta', names({ ...base, sort: 'rating' }))
check('by year, newest first',
  names({ ...base, sort: 'year' }).slice(0, 2).join(',') === 'Alpha,Echo',
  names({ ...base, sort: 'year' }))
check('two titles from the same year keep a stable order',
  names({ ...base, sort: 'year' }).slice(0, 2).join(',') === 'Alpha,Echo')
check('by when the provider added it',
  names({ ...base, sort: 'added' }).slice(0, 2).join(',') === 'Bravo,Echo',
  names({ ...base, sort: 'added' }))
check('and a title with no date sorts last',
  names({ ...base, sort: 'added' })[4] === 'Delta', names({ ...base, sort: 'added' }))

console.log('\nFilters')

check('a minimum rating excludes what is below it',
  names({ ...base, minRating: 7 }).join(',') === 'Alpha,Charlie,Echo',
  names({ ...base, minRating: 7 }))
check('and excludes what has no rating at all',
  !names({ ...base, minRating: 7 }).includes('Delta'))
check('the boundary is inclusive', names({ ...base, minRating: 7 }).includes('Echo'))
check('a decade keeps only that decade',
  names({ ...base, yearFrom: 2020, yearTo: 2029 }).join(',') === 'Alpha,Echo',
  names({ ...base, yearFrom: 2020, yearTo: 2029 }))
check('an older decade too',
  names({ ...base, yearFrom: 1990, yearTo: 1999 }).join(',') === 'Bravo')
check('filters combine',
  names({ ...base, minRating: 8, yearFrom: 2020, yearTo: 2029 }).join(',') === 'Alpha')
check('the count agrees with the rows',
  catalog.countChannels({ ...base, minRating: 7 }) === 3,
  catalog.countChannels({ ...base, minRating: 7 }))
check('a filter nothing matches is empty rather than an error',
  names({ ...base, minRating: 10 }).length === 0)

console.log('\nLive channels are left alone')

importCatalog(source.id, 'live', [], [
  { ...film('live1', 'A Channel', null, null, null), externalId: 'live1' }
])
check('a live list still works with no metadata',
  catalog.queryChannels({ playlistId: source.id, kind: 'live', limit: 10 }).length === 1)

console.log('\nRe-syncing')

// A panel that omits the rating on one refresh must not erase what it sent on
// the last, or a catalogue quietly degrades every time it is synced.
importCatalog(source.id, 'movie', [], [
  film('1', 'Alpha', null, null, null),
  film('2', 'Bravo', 6.0, 1998, 5000),
  film('3', 'Charlie', 9.1, 2015, 1000),
  film('4', 'Delta', null, null, null),
  film('5', 'Echo', 7.0, 2021, 4000)
])
const alpha = catalog.queryChannels(base).find((r) => r.name === 'Alpha')
check('a rating the provider stopped sending is kept', alpha?.rating === 8.5, alpha?.rating)
check('and so is the year', alpha?.year === 2021, alpha?.year)

console.log(failures === 0 ? '\nvodfilters: all passed' : `\nvodfilters: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
