import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { TmdbClient, toMeta, yearOf } from '@main/sources/tmdb'
import { enrich, searchTitle } from '@main/sources/tmdbMeta'
import type { VodInfo } from '@shared/types'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Metadata for titles a provider described poorly.
 *
 * The client is exercised against a local server rather than TMDB: the point
 * is the shape of what comes back and what is made of it, and a test that
 * needs somebody's API key is a test that does not run.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const MOVIE_SEARCH = {
  results: [
    { id: 42, title: 'A Quiet Field', release_date: '2019-04-11' },
    { id: 99, title: 'A Quiet Field: Again', release_date: '2022-01-01' }
  ]
}

const MOVIE_DETAIL = {
  id: 42,
  title: 'A Quiet Field',
  overview: 'Nothing much happens, beautifully.',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  release_date: '2019-04-11',
  vote_average: 7.4499,
  runtime: 102,
  genres: [{ id: 18, name: 'Drama' }, { id: 9648, name: 'Mystery' }],
  credits: {
    cast: Array.from({ length: 20 }, (_, i) => ({ name: `Player ${i + 1}` })),
    crew: [{ name: 'Someone Else', job: 'Editor' }, { name: 'A Director', job: 'Director' }]
  }
}

const SERIES_SEARCH = { results: [{ id: 7, name: 'The Long Road', first_air_date: '2018-06-20' }] }
const SERIES_DETAIL = {
  id: 7,
  name: 'The Long Road',
  overview: 'It is long.',
  first_air_date: '2018-06-20',
  episode_run_time: [48, 52],
  vote_average: 0,
  genres: [],
  credits: { cast: [], crew: [] }
}

interface Recorded {
  path: string
  query: URLSearchParams
}

function serve(): Promise<{ server: Server; base: string; seen: Recorded[]; fail: (status: number, body?: unknown) => void }> {
  const seen: Recorded[] = []
  let failure: { status: number; body?: unknown } | null = null

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '', 'http://127.0.0.1')
    seen.push({ path: url.pathname, query: url.searchParams })

    if (failure) {
      res.writeHead(failure.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(failure.body ?? {}))
      return
    }

    const answer =
      url.pathname === '/search/movie' ? MOVIE_SEARCH
        : url.pathname === '/search/tv' ? SERIES_SEARCH
          : url.pathname === '/movie/42' ? MOVIE_DETAIL
            : url.pathname === '/tv/7' ? SERIES_DETAIL
              : null

    if (!answer) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status_message: 'The resource you requested could not be found.' }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(answer))
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        seen,
        fail: (status, body) => {
          failure = { status, body }
        }
      })
    })
  })
}

async function main(): Promise<void> {
  const { server, base, seen, fail } = await serve()
  const client = new TmdbClient('test-key', 5000, base)

  console.log('\nReading a year out of a date')
  check('a release date', yearOf('2019-04-11') === 2019)
  check('a missing one', yearOf(undefined) === null)
  check('an empty one', yearOf('') === null)
  check('something absurd', yearOf('0007-01-01') === null)

  console.log('\nFinding a film')
  const movie = await client.find('movie', 'A Quiet Field', 2019)
  check('something came back', movie !== null)
  check('the plot', movie?.plot === 'Nothing much happens, beautifully.', movie?.plot)
  check('the year', movie?.year === 2019, movie?.year)
  check('the rating is rounded to one decimal', movie?.rating === 7.4, movie?.rating)
  check('the runtime is in seconds', movie?.runtimeSecs === 102 * 60, movie?.runtimeSecs)
  check('the director is picked out of the crew', movie?.director === 'A Director', movie?.director)
  check('the genres', movie?.genres.join(',') === 'Drama,Mystery', movie?.genres)

  // A full cast is forty names nobody reads, and a detail sheet has room for
  // the top of the billing.
  check('the cast is the top of the billing, not all of it', movie?.cast.length === 8, movie?.cast.length)
  check('and it is the top', movie?.cast[0] === 'Player 1', movie?.cast[0])

  // Images come from a different host and need a size; the original of a
  // backdrop is several megabytes to draw behind a sheet.
  check('the poster has a size in its path', movie?.posterUrl?.includes('/w500/poster.jpg') === true, movie?.posterUrl)
  check('and the backdrop a larger one', movie?.backdropUrl?.includes('/w1280/backdrop.jpg') === true, movie?.backdropUrl)

  console.log('\nWhat was asked for')
  const search = seen.find((r) => r.path === '/search/movie')
  check('the key is sent', search?.query.get('api_key') === 'test-key')
  check('the title is the query', search?.query.get('query') === 'A Quiet Field')
  // The year is what stops a remake matching ahead of the film asked for.
  check('the year narrows it', search?.query.get('year') === '2019', search?.query.get('year'))

  seen.length = 0
  await client.find('movie', 'A Quiet Field', null)
  const noYear = seen.find((r) => r.path === '/search/movie')
  check('and is left out when the provider gave none', noYear?.query.get('year') === null)

  console.log('\nFinding a series')
  seen.length = 0
  const series = await client.find('series', 'The Long Road', 2018)
  check('a series is searched on the tv endpoint', seen.some((r) => r.path === '/search/tv'))
  check('with its own year parameter', seen[0]?.query.get('first_air_date_year') === '2018')
  check('the first-aired date becomes the year', series?.year === 2018, series?.year)
  // A series reports a list of per-episode runtimes; a film reports one number.
  check('a per-episode runtime is used', series?.runtimeSecs === 48 * 60, series?.runtimeSecs)
  // Zero votes is not a rating of zero, it is no rating.
  check('an unrated title has no rating', series?.rating === null, series?.rating)

  console.log('\nWhen there is nothing to find')
  const empty = toMeta('movie', 1, { title: '', overview: '', vote_average: 0 })
  check('an empty title is null, not an empty string', empty.title === null)
  check('an empty plot likewise', empty.plot === null)
  check('no images', empty.posterUrl === null && empty.backdropUrl === null)

  console.log('\nRefusals say what to do about them')
  const refusal = async (status: number, body?: unknown): Promise<string> => {
    fail(status, body)
    try {
      await client.find('movie', 'x', null)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  // A wrong key and a key being used too fast call for opposite responses
  // from whoever reads the message, so the status alone is not enough.
  check('a bad key says so', (await refusal(401)).includes('API key'), await refusal(401))
  check('rate limiting says to wait', (await refusal(429)).includes('rate-limiting'))
  check(
    'anything else carries what the service said',
    (await refusal(500, { status_message: 'Internal error.' })).includes('Internal error.')
  )

  /*
   * What a provider's catalogue calls a film.
   *
   * Searching for the decorated string finds nothing — and "nothing" is then
   * cached as the answer for a month, so a bad trim does not fail loudly, it
   * fails quietly and stays failed.
   */
  console.log('\nTrimming a provider title down to something searchable')
  const trims: [string, string][] = [
    ['A Quiet Field', 'A Quiet Field'],
    ['|TR| A Quiet Field', 'A Quiet Field'],
    ['[4K] A Quiet Field', 'A Quiet Field'],
    ['A Quiet Field (2019)', 'A Quiet Field'],
    ['A Quiet Field 2019 1080p WEB-DL', 'A Quiet Field'],
    ['A.Quiet.Field.2019.x265', 'A Quiet Field'],
    ['A Quiet Field FHD', 'A Quiet Field'],
    ['A Quiet Field.mkv', 'A Quiet Field'],
    ['A Quiet Field TR DUBLAJ', 'A Quiet Field TR']
  ]

  for (const [given, wanted] of trims) {
    const got = searchTitle(given)
    check(`"${given}" searches as "${wanted}"`, got === wanted, got)
  }

  // A title that is only decoration must not become an empty search, which
  // would match something arbitrary.
  check('a title that is all decoration comes back empty', searchTitle('[4K] 1080p') === '')

  // A year in the name is not a film from that year necessarily, but it is
  // the provider's own claim and the trim must not take the title with it.
  check('a numeric title survives', searchTitle('1917') === '1917', searchTitle('1917'))

  /*
   * The provider wins, every time.
   *
   * The match is made by title, and a title search can return a remake, a
   * documentary about the film, or a different work with the same name.
   * Overwriting a correct local plot with a confident wrong one is worse
   * than the gap it filled — so a field the provider filled is never
   * touched, and that has to be true without a key as well as with one.
   */
  console.log('\nWhat enrichment is allowed to change')

  const full: VodInfo = {
    channelId: 1,
    plot: "The provider's own plot.",
    cast: 'Their Cast',
    director: 'Their Director',
    genre: 'Their Genre',
    releaseDate: '2001-02-03',
    rating: 5.5,
    durationSecs: 60,
    backdropUrl: 'http://provider.test/backdrop.jpg',
    trailerId: 'abc'
  }

  // No key is set in this test run, so enrichment is off entirely — and off
  // must mean "returns exactly what it was given", including null.
  const untouched = await enrich(1, full)
  check('with no key, a full record is returned unchanged', untouched === full)
  check('and a null one stays null', (await enrich(1, null)) === null)

  /*
   * The attribution TMDB's terms require.
   *
   * Their wording is exact and it is not ours to paraphrase: the notice must
   * appear "prominently", in an About or Credits type section, and TMDB must
   * be called TMDB or The Movie Database and nothing else. A translated or
   * reworded version would be a licence breach wearing the clothes of a
   * nicety, so the English sentence is the same in every locale — which is
   * easy to "fix" later without knowing why, hence this.
   */
  console.log('\nThe notice TMDB requires')
  const NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.'

  for (const locale of ['en', 'tr', 'de']) {
    const file = readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'i18n', `${locale}.ts`), 'utf8')
    check(`${locale} carries the notice verbatim`, file.includes(NOTICE))
  }

  const credit = readFileSync(
    join(process.cwd(), 'src', 'renderer', 'src', 'features', 'settings', 'TmdbAttribution.tsx'),
    'utf8'
  )
  check('and the credit renders it', credit.includes('settings.metaAttribution'))

  const section = readFileSync(
    join(process.cwd(), 'src', 'renderer', 'src', 'features', 'settings', 'MetadataSection.tsx'),
    'utf8'
  )
  check('which the settings section shows', section.includes('<TmdbAttribution />'))

  /*
   * And the logo, which is the other half of the condition.
   *
   * It is not in this repository on purpose: it is TMDB's, it has to come
   * from their attribution page unaltered, and a copy taken from somewhere
   * else is how a project ships a logo that was retired two years ago. So
   * this fails until somebody puts it there — a licence condition nobody is
   * reminded of is a licence condition that gets forgotten.
   *
   * See src/renderer/src/assets/README.md.
   */
  const assets = join(process.cwd(), 'src', 'renderer', 'src', 'assets')
  const logo = ['tmdb.svg', 'tmdb.png'].map((name) => join(assets, name)).find((path) => existsSync(path))

  check(
    'the TMDB logo is present (see src/renderer/src/assets/README.md)',
    logo !== undefined,
    'expected src/renderer/src/assets/tmdb.svg'
  )

  if (logo) {
    const bytes = statSync(logo).size
    check('and is a real file rather than a placeholder', bytes > 200, bytes)
  }

  server.close()
}

void main().then(
  () => {
    console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
    process.exit(failures === 0 ? 0 : 1)
  },
  (error) => {
    console.error('\nTest run threw:', error)
    process.exit(1)
  }
)
