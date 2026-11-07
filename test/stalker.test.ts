import {
  StalkerClient,
  candidateEndpoints,
  hasBlankStreamId,
  linkAttempts,
  plainText,
  isMacAddress,
  listOf,
  normalizeMac,
  serialFor,
  stripLinkPrefix,
  toChannel,
  toProgramme,
  toVodItem
} from '@main/sources/stalker'
import { redact } from '@main/util/http'
import { MAC, startPortal, type Portal } from './stalkerportal'

/**
 * What can and cannot be concluded from this file.
 *
 * Every check below runs against `test/stalkerportal.cjs`, a portal that
 * answers the protocol this client was written against. Passing proves the
 * client and that written protocol agree. It does not prove the client works
 * against a real portal, because real portals differ from the documentation in
 * undocumented ways — which is the whole difficulty of this source type.
 *
 * So the simulator is pointed at the places clients are known to break rather
 * than at a happy path: an unexpected path, an expired token, a portal that
 * ignores pagination, a player hint in front of the link, a missing optional
 * call. Those are guesses about reality too, but they are informed ones.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const client = (portal: Portal, overrides: Record<string, unknown> = {}): StalkerClient =>
  new StalkerClient({ portalUrl: portal.url, macAddress: MAC, ...overrides })

async function main(): Promise<void> {
  console.log('\nReading a MAC address the way people actually write it')

  check('colons are kept', normalizeMac('00:1A:79:AA:BB:CC') === '00:1A:79:AA:BB:CC')
  check('lower case is raised', normalizeMac('00:1a:79:aa:bb:cc') === '00:1A:79:AA:BB:CC')
  check('dashes become colons', normalizeMac('00-1A-79-AA-BB-CC') === '00:1A:79:AA:BB:CC')
  check('no separators at all still works', normalizeMac('001A79AABBCC') === '00:1A:79:AA:BB:CC')
  check('stray spaces are ignored', normalizeMac(' 00:1a:79:aa:bb:cc ') === '00:1A:79:AA:BB:CC')
  check('something that is not a MAC is recognised', !isMacAddress('not-a-mac'))
  check('and one that is, is', isMacAddress('00:1a:79:aa:bb:cc'))
  check('a short one is refused', !isMacAddress('00:1a:79:aa:bb'))
  check('the serial is stable for a MAC', serialFor(MAC) === serialFor(normalizeMac('001a79aabbcc')))

  console.log('\nWorking out which address a portal answers on')

  const guesses = candidateEndpoints('http://panel.example.com:8080/c/')
  check('the browser page is not treated as the endpoint',
    !guesses.includes('http://panel.example.com:8080/c/'), guesses)
  check('the usual endpoint is tried',
    guesses.includes('http://panel.example.com:8080/portal.php'), guesses)
  check('and so is the other usual one',
    guesses.includes('http://panel.example.com:8080/server/load.php'), guesses)
  check('an address that already names an endpoint is tried first',
    candidateEndpoints('http://panel.example.com/stalker_portal/server/load.php')[0] ===
      'http://panel.example.com/stalker_portal/server/load.php')
  check('a bare host is accepted',
    candidateEndpoints('panel.example.com').includes('http://panel.example.com/portal.php'))
  check('nonsense produces nothing rather than throwing', candidateEndpoints('   ').length === 0)
  check('no address is tried twice', new Set(guesses).size === guesses.length, guesses)

  console.log('\nReading what a portal sends back')

  check('the documented list shape is read', listOf({ data: [{ id: '1' }] }).length === 1)
  check('a bare array is read too', listOf([{ id: '1' }]).length === 1)
  check('and a map keyed by id', listOf({ data: { a: { id: '1' }, b: { id: '2' } } }).length === 2)
  check('anything else is empty, not an error', listOf({ nope: true }).length === 0)
  check('so is null', listOf(null).length === 0)

  check('the player hint is removed', stripLinkPrefix('ffmpeg http://h/s') === 'http://h/s')
  check('and the numbered variants', stripLinkPrefix('ffrt3 http://h/s') === 'http://h/s')
  check('and auto', stripLinkPrefix('auto http://h/s') === 'http://h/s')
  check('a bare URL is left alone', stripLinkPrefix('http://h/s') === 'http://h/s')
  check('a URL that merely starts with those letters is left alone',
    stripLinkPrefix('http://ffmpeg.example.com/s') === 'http://ffmpeg.example.com/s')

  const row = toChannel({
    id: 7, name: 'Alto Sports 2', cmd: 'ffrt http://h/ch/7', number: '12',
    logo: 'http://h/l.png', xmltv_id: 'alto.2', tv_genre_id: '3', censored: '1',
    tv_archive_duration: '7'
  })
  check('a channel keeps its cmd rather than a URL', row?.streamUrl === 'ffrt http://h/ch/7', row)
  check('a number sent as a string is a number', row?.number === 12, row)
  check('an adult flag sent as a string is a boolean', row?.isAdult === true, row)
  check('the archive length is carried', row?.catchupDays === 7, row)
  check('a row with no cmd is not a channel', toChannel({ id: 1, name: 'x' }) === null)
  check('a row with no name is not a channel', toChannel({ id: 1, cmd: 'x' }) === null)
  check('a cmd given as a list is found',
    toChannel({ id: 1, name: 'x', cmds: [{ url: 'ffmpeg http://h/1' }] })?.streamUrl ===
      'ffmpeg http://h/1')

  const now = Math.floor(Date.now() / 1000)
  const programme = toProgramme('5', {
    name: 'Match', descr: 'A match', start_timestamp: now, stop_timestamp: now + 3600
  })
  check('seconds become milliseconds', programme?.startsAt === now * 1000, programme)
  check('a programme with no end is dropped',
    toProgramme('5', { name: 'x', start_timestamp: now }) === null)
  check('and one that ends before it starts',
    toProgramme('5', { name: 'x', start_timestamp: now, stop_timestamp: now - 1 }) === null)

  console.log('\nAgainst a portal that answers the documented way')

  const portal = await startPortal()
  const account = await client(portal).authenticate()
  check('it authenticates', account !== null)
  check('and reports what the portal says about the subscription',
    account.login === 'demo-account' && account.status === 'Active', account)
  check('the profile call really was made', portal.seen.requests.includes('stb/get_profile'),
    portal.seen.requests)
  check('the MAC was sent as a cookie', portal.seen.macs.includes(MAC), portal.seen.macs)
  check('the token was sent as a bearer', portal.seen.tokens.length > 0, portal.seen.tokens)
  check('it introduced itself as a set-top box',
    portal.seen.userAgents.some((ua) => ua?.includes('MAG200 stbapp')), portal.seen.userAgents)
  check('and sent the referer a box sends',
    portal.seen.referers.some((r) => r?.endsWith('/c/')), portal.seen.referers)

  const catalogue = await client(portal).liveCatalog()
  check('every channel is listed', catalogue.channels.length === 5, catalogue.channels.length)
  check('genres become categories', catalogue.categories.length === 2, catalogue.categories)
  check('the portal\'s own "all" pseudo-genre is not one of them',
    catalogue.categories.every((c) => c.externalId !== '*'), catalogue.categories)
  check('a channel carries its genre', catalogue.channels[0]?.categoryExternalId !== null)
  check('the adult flag survives', catalogue.channels.some((c) => c.isAdult === true))

  const link = await client(portal).streamUrl('ffrt http://localhost/ch/3', '3')
  check('a link comes back without the player hint', !link.startsWith('ffmpeg'), link)
  check('and it names the channel', link.includes('stream=3'), link)

  const epg = await client(portal).shortEpg('1')
  check('the portal guide is read', epg.length === 2, epg)
  check('the unusable entry is dropped rather than failing the rest',
    epg.every((p) => p.endsAt > p.startsAt), epg)
  portal.close()

  console.log('\nAgainst a portal on a different path')

  const moved = await startPortal({ path: '/stalker_portal/server/load.php' })
  const movedCatalog = await client(moved).liveCatalog()
  check('it is found anyway', movedCatalog.channels.length === 5, movedCatalog.channels.length)
  moved.close()

  console.log('\nAgainst a portal that will not list everything at once')

  const paged = await startPortal({ paginate: true, pageSize: 2, channels: 5 })
  const pagedCatalog = await client(paged).liveCatalog()
  check('every page is walked', pagedCatalog.channels.length === 5, pagedCatalog.channels.length)
  check('and nothing is listed twice',
    new Set(pagedCatalog.channels.map((c) => c.externalId)).size === 5, pagedCatalog.channels)
  paged.close()

  console.log('\nAgainst a portal that ignores the page it was asked for')

  // This one hangs a client that trusts pagination: every page comes back as
  // page one, so the loop never runs out of rows.
  const stuck = await startPortal({ paginate: true, ignorePages: true, pageSize: 2, channels: 5 })
  const started = Date.now()
  const stuckCatalog = await client(stuck).liveCatalog()
  check('it stops rather than looping forever', Date.now() - started < 10_000,
    `${Date.now() - started}ms`)
  check('and keeps what it did get', stuckCatalog.channels.length === 2, stuckCatalog.channels.length)
  stuck.close()

  console.log('\nAgainst a portal with no account endpoint')

  const bare = await startPortal({ noAccountInfo: true })
  const bareAccount = await client(bare).authenticate()
  check('a missing nicety does not fail the sign-in', bareAccount !== null, bareAccount)
  check('it just has nothing to report', bareAccount.login === null, bareAccount)
  bare.close()

  console.log('\nWhen the MAC is not subscribed')

  const strict = await startPortal({ mac: '00:1A:79:FF:FF:FF' })
  let refusedMessage = ''
  try {
    await client(strict).liveCatalog()
  } catch (error) {
    refusedMessage = error instanceof Error ? error.message : String(error)
  }
  check('it fails rather than syncing an empty catalogue', refusedMessage !== '', refusedMessage)
  check('and the message is about the portal, not about JSON',
    !refusedMessage.includes('Unexpected token'), refusedMessage)
  strict.close()

  console.log('\nWhen the session expires partway through')

  const expiring = await startPortal({ expireTokenAfter: 2 })
  let expiredMessage = ''
  try {
    await client(expiring).liveCatalog()
  } catch (error) {
    expiredMessage = error instanceof Error ? error.message : String(error)
  }
  check('the failure says which call broke',
    /itv\/|stb\/|account_info\//.test(expiredMessage), expiredMessage)
  check('and quotes what the portal actually sent',
    expiredMessage.toLowerCase().includes('session expired') ||
      expiredMessage.toLowerCase().includes('html'), expiredMessage)
  expiring.close()

  console.log('\nWhen a portal will not recognise the command it gave us')

  // Taken from a real portal. Every link it returned had an empty stream id —
  // a 200, a plausible URL, and nothing playable at the end of it. ffmpeg then
  // reported a 4xx, which reads as a dead channel rather than as a client
  // asking in a form the portal does not use.
  check('a blank id is recognised',
    hasBlankStreamId('http://h/play/live.php?mac=x&stream=&extension=ts'))
  check('a real one is not',
    !hasBlankStreamId('http://h/play/live.php?mac=x&stream=42&extension=ts'))
  check('a URL with no id parameter at all is not blank',
    !hasBlankStreamId('http://h/live/42.ts'))
  check('nor is something unparseable', !hasBlankStreamId('not a url'))

  const forms = linkAttempts('ffrt http://localhost/ch/9', '9')
  check('the stored form is tried first', forms[0]?.name === 'stored', forms)
  check('then the same without the player hint',
    forms[1]?.cmd === 'http://localhost/ch/9', forms)
  check('a form is never tried twice',
    new Set(forms.map((f) => f.cmd)).size === forms.length, forms)
  check('with no channel id there is nothing to rebuild from',
    linkAttempts('http://localhost/ch/9').length === 1, linkAttempts('http://localhost/ch/9'))

  const bareOnly = await startPortal({ acceptsCmd: 'bare' })
  const bareLink = await client(bareOnly).streamUrl('ffrt http://localhost/ch/4', '4')
  check('a portal that wants the bare command is accommodated',
    bareLink.includes('stream=4'), bareLink)
  bareOnly.close()

  const canonicalOnly = await startPortal({ acceptsCmd: 'canonical' })
  const rebuilt = await client(canonicalOnly).streamUrl('http://cdn.example/stream/4.ts', '4')
  check('and so is one that only matches a command rebuilt from the id',
    rebuilt.includes('stream=4'), rebuilt)
  canonicalOnly.close()

  const hopeless = await startPortal({ acceptsCmd: 'canonical' })
  let linkError = ''
  try {
    await client(hopeless).streamUrl('http://cdn.example/stream/4.ts')
  } catch (error) {
    linkError = error instanceof Error ? error.message : String(error)
  }
  hopeless.close()
  check('when no form works it fails rather than returning a dead URL',
    linkError !== '', linkError)
  check('saying what the portal did with each form',
    linkError.includes('empty stream id'), linkError)
  check('and quoting the command the catalogue stored',
    linkError.includes('cdn.example'), linkError)

  console.log('\nWhen a portal names its fields differently')

  // The reason this section exists: this adapter cannot be checked against a
  // real portal here, so the thing that has to work is not the happy path but
  // the report when the happy path does not happen. A portal answering with
  // field names nobody documented must produce a log line naming them, or the
  // first person to meet one has nothing to send back.
  const odd = await startPortal({ oddFieldNames: true })
  const warnings: string[] = []
  const realWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(' '))
  }
  let oddCount = -1
  try {
    oddCount = (await client(odd).liveCatalog()).channels.length
  } catch {
    oddCount = 0
  } finally {
    console.warn = realWarn
  }
  odd.close()

  check('nothing is read, rather than something wrong', oddCount === 0, oddCount)
  check('and the log says how many rows it could not read',
    warnings.some((w) => w.includes('out of')), warnings)
  check('naming the fields the portal actually used',
    warnings.some((w) => w.includes('channel_id') && w.includes('stream_cmd')), warnings)
  check('and what a channel needs instead',
    warnings.some((w) => w.includes('id, a name and a cmd')), warnings)

  console.log('\nShowing a portal\'s own words to the user')

  // Verbatim from a real portal. The message is worth showing — it is the
  // provider saying what to do — but it arrives as a fragment of HTML and went
  // into the dialog with the tag still in it.
  check('a tag becomes a space',
    plainText('Validation error occured.<br />Call Provider.+972 74 703 3333') ===
      'Validation error occured. Call Provider.+972 74 703 3333',
    plainText('Validation error occured.<br />Call Provider.+972 74 703 3333'))
  check('entities are decoded', plainText('Tom &amp; Jerry') === 'Tom & Jerry')
  check('plain text is left alone', plainText('Account expired') === 'Account expired')
  check('and runs of space are collapsed', plainText('a  \n  b') === 'a b')

  console.log('\nReading a film out of a listing')

  check('a film is prefixed so it is not filed as live TV',
    toVodItem({ id: '7', name: 'A Film', cmd: '/media/7.mpg' }, 'movie')?.externalId === 'vod:7')
  check('a show is prefixed too',
    toVodItem({ id: '7', name: 'A Show' }, 'series')?.externalId === 'series:7')

  // A show has no single thing to play — episodes are addressed by series
  // number against the show — so an empty stream URL is correct for one and
  // fatal for a film. Dropping shows for want of a `cmd` would list none.
  check('a film with no command is dropped',
    toVodItem({ id: '8', name: 'No Command' }, 'movie') === null)
  check('a show with no command is kept',
    toVodItem({ id: '8', name: 'No Command' }, 'series')?.streamUrl === '')

  check('a row with no name is dropped',
    toVodItem({ id: '9', cmd: '/x' }, 'movie') === null)
  check('the second-choice name is used when the first is missing',
    toVodItem({ id: '9', o_name: 'ORIGINAL', cmd: '/x' }, 'movie')?.name === 'ORIGINAL')

  check('a ten-point rating is read',
    toVodItem({ id: '1', name: 'x', cmd: '/x', rating_imdb: '7.4' }, 'movie')?.rating === 7.4)
  check('the year is read',
    toVodItem({ id: '1', name: 'x', cmd: '/x', year: '1999' }, 'movie')?.year === 1999)

  // `added` is when the portal listed it, which is not when the film was
  // made. Reading it as a year would mislabel everything whose year is blank.
  check('the date it was added is not mistaken for the release year',
    toVodItem({ id: '1', name: 'x', cmd: '/x', added: '2020-01-15 18:04:00' }, 'movie')?.year === null)
  check('but it is kept as when the provider added it',
    toVodItem({ id: '1', name: 'x', cmd: '/x', added: '2020-01-15 18:04:00' }, 'movie')
      ?.providerAddedAt === Date.UTC(2020, 0, 15, 18, 4, 0))
  check('a zeroed date is nothing, not 1970',
    toVodItem({ id: '1', name: 'x', cmd: '/x', added: '0000-00-00 00:00:00' }, 'movie')
      ?.providerAddedAt === null)

  console.log('\nAgainst a portal that also sells films and shows')

  const shop = await startPortal({ movies: 3, shows: 2, pageSize: 2 })

  const films = await client(shop).movieCatalog()
  check('every film is listed, across pages', films.channels.length === 3, films.channels.length)
  check('they are filed as films', films.kind === 'movie')
  check('film categories are read', films.categories.length === 2, films.categories)
  check('the "all" pseudo-category is not one of them',
    films.categories.every((c) => c.externalId !== '*'), films.categories)
  check('a film keeps its poster',
    films.channels[0]?.logoUrl?.includes('/poster/') === true, films.channels[0]?.logoUrl)
  check('a film keeps its rating', films.channels.every((c) => typeof c.rating === 'number'))
  check('the adult flag survives here too', films.channels.some((c) => c.isAdult === true))
  check('a film with no year listed simply has none',
    films.channels.some((c) => c.year === null), films.channels.map((c) => c.year))

  const shows = await client(shop).seriesCatalog()
  check('every show is listed', shows.channels.length === 2, shows.channels.length)
  check('they are filed as series', shows.kind === 'series')
  check('a show the portal gives nothing to play stays listed anyway',
    shows.channels.some((c) => c.streamUrl === ''), shows.channels.map((c) => c.streamUrl))
  check('shows have their own categories',
    shows.categories.length === 1 && shows.categories[0]?.name === 'Drama', shows.categories)

  // The same action serves all three; only `type` says which. Asking for
  // films and getting channels back is the failure that looks like success.
  check('films were asked for as films',
    shop.seen.requests.includes('vod/get_ordered_list'), shop.seen.requests)
  check('and shows as shows',
    shop.seen.requests.includes('series/get_ordered_list'), shop.seen.requests)
  check('a film is not a channel',
    films.channels.every((c) => !shows.channels.some((s) => s.externalId === c.externalId)))

  console.log('\nEpisodes, which a portal puts on the listing row')

  const playable = shows.channels.find((c) => c.streamUrl !== '')!
  const unplayable = shows.channels.find((c) => c.streamUrl === '')!

  check('a show carries its episode numbers',
    playable.episodeNumbers?.join(',') === '1,2,3', playable.episodeNumbers)

  // A list of episodes that all fail on click is a worse answer than saying
  // there are none, so the numbers are only kept when there is a command to
  // play them with.
  check('a show with nothing to play them with carries none',
    unplayable.episodeNumbers === undefined, unplayable.episodeNumbers)

  check('a film carries none either',
    films.channels.every((c) => c.episodeNumbers === undefined))

  // The numbers are the identifiers the portal is given back, so they are
  // kept as sent. Renumbering from one would make episode 4 of a part-listed
  // show ask for episode 1.
  check('numbers are kept as the portal sent them, not renumbered',
    toVodItem({ id: '1', name: 'x', cmd: '/x', series: [4, 5, 6] }, 'series')
      ?.episodeNumbers?.join(',') === '4,5,6')
  check('out of order they are sorted',
    toVodItem({ id: '1', name: 'x', cmd: '/x', series: [3, 1, 2] }, 'series')
      ?.episodeNumbers?.join(',') === '1,2,3')
  check('duplicates collapse',
    toVodItem({ id: '1', name: 'x', cmd: '/x', series: [1, 1, 2] }, 'series')
      ?.episodeNumbers?.join(',') === '1,2')
  check('nonsense is dropped rather than stored as an episode',
    toVodItem({ id: '1', name: 'x', cmd: '/x', series: ['x', -1, 2.5, 3] }, 'series')
      ?.episodeNumbers?.join(',') === '3')
  check('an empty list is no list at all',
    toVodItem({ id: '1', name: 'x', cmd: '/x', series: [] }, 'series')?.episodeNumbers === undefined)

  console.log('\nPlaying a film and an episode')

  const filmLink = await client(shop).vodUrl('/media/1.mpg')
  check('a film gets a link', filmLink.startsWith('http://'), filmLink)
  check('without the player hint on the front', !filmLink.startsWith('ffmpeg'), filmLink)

  // The failure this guards: a film asked for through the live handler comes
  // back as a channel URL with an empty id, which looks exactly like success
  // until it reaches ffmpeg.
  check('a film is fetched through the portal\'s film handler, not its live one',
    filmLink.includes('/play/vod.php'), filmLink)
  check('and the live handler was not used for it',
    !filmLink.includes('/play/live.php'), filmLink)

  const episodeLink = await client(shop).vodUrl('/media/show-1.mpg', 2)
  check('an episode names which episode it is', episodeLink.includes('series=2'), episodeLink)
  check('a film asks for no episode at all', !filmLink.includes('series='), filmLink)

  // `streamUrl` would, as a last resort, rebuild the command as /ch/<id>.
  // A film has no channel id, so that attempt can only ask for a channel that
  // does not exist — which is why the VOD path has its own shorter ladder.
  check('the film path does not try to rebuild a channel command',
    linkAttempts('/media/1.mpg').length === 1, linkAttempts('/media/1.mpg'))
  check('where the live path would', linkAttempts('ffrt http://x/ch/9', '9').length > 1)

  shop.close()

  console.log('\nAgainst a portal that sells live TV and nothing else')

  const liveOnly = await startPortal({ noVod: true })
  const none = await client(liveOnly).movieCatalog()
  check('asking for films gets an empty catalogue, not an error', none.channels.length === 0)
  check('and no categories either', none.categories.length === 0)
  const stillWorks = await client(liveOnly).liveCatalog()
  check('and the channels it does sell are unaffected', stillWorks.channels.length === 5,
    stillWorks.channels.length)
  liveOnly.close()

  console.log('\nThe MAC never reaches the log')

  const line = `GET http://host/portal.php?mac=${encodeURIComponent(MAC)}&action=handshake`
  check('an encoded MAC in a URL is hidden', !redact(line).includes('1A%3A79'), redact(line))
  check('a plain MAC is hidden too',
    !redact(`Cookie: mac=${MAC}; stb_lang=en`).includes(MAC), redact(`Cookie: mac=${MAC}`))
  check('the dashed form is hidden',
    !redact('mac=00-1A-79-AA-BB-CC').includes('00-1A-79-AA-BB-CC'), redact('mac=00-1A-79-AA-BB-CC'))
  check('lower case is hidden',
    !redact('mac=00:1a:79:aa:bb:cc').includes('aa:bb:cc'), redact('mac=00:1a:79:aa:bb:cc'))
  check('and the rest of the line survives',
    redact(line).includes('action=handshake'), redact(line))

  console.log(failures === 0 ? '\nstalker: all passed' : `\nstalker: ${failures} failed`)
  process.exit(failures === 0 ? 0 : 1)
}

void main().catch((error) => {
  console.error('\nTest run threw:', error)
  process.exit(1)
})
