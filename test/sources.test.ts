import { parseM3u } from '@main/sources/m3u'
import { XtreamClient } from '@main/sources/xtream'
import { fold } from '@main/db/index'

const SAMPLE = `#EXTM3U x-tvg-url="http://ex.com/xmltv.php"
#EXTINF:-1 tvg-id="harbour.sports.uk" tvg-name="Harbour Sports Main Event" tvg-logo="http://l/1.png" tvg-chno="401" group-title="UK | SPORTS",Harbour Sports Main Event FHD
http://ex.com:8080/live/user/pass/1001.m3u8
#EXTINF:-1 tvg-id="" tvg-logo="" group-title="UK | SPORTS",BT Sport 1
http://ex.com:8080/live/user/pass/1002.ts
#EXTINF:-1 group-title="XXX ADULT",Some Adult Channel
http://ex.com:8080/live/user/pass/1003.ts
#EXTINF:-1 tvg-name="ARD HD",ARD
#EXTGRP:DE | GENERAL
http://ex.com:8080/live/user/pass/1004.ts
#EXTINF:-1,No Group Channel
http://ex.com:8080/live/user/pass/1005.ts
`

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nM3U parser')
const catalog = parseM3u(SAMPLE)
check('parses all 5 entries', catalog.channels.length === 5, catalog.channels.length)
check('extracts tvg-id', catalog.channels[0]!.epgChannelId === 'harbour.sports.uk')
check('prefers tvg-name over display title', catalog.channels[0]!.name === 'Harbour Sports Main Event')
check('parses tvg-chno as number', catalog.channels[0]!.number === 401)
check('detects m3u8 extension', catalog.channels[0]!.containerExtension === 'm3u8')
check('empty tvg-id becomes null', catalog.channels[1]!.epgChannelId === null)
check('flags adult group', catalog.channels[2]!.isAdult === true)
check('honours #EXTGRP fallback', catalog.channels[3]!.categoryExternalId === 'de-general')
check('ungrouped falls back to uncategorized', catalog.channels[4]!.categoryExternalId === '__uncategorized__')
check('builds 4 categories', catalog.categories.length === 4, catalog.categories.map((c) => c.name))
check('external ids are unique', new Set(catalog.channels.map((c) => c.externalId)).size === 5)

const again = parseM3u(SAMPLE)
check('ids are stable across re-parse', again.channels[0]!.externalId === catalog.channels[0]!.externalId)

console.log('\nDuplicate URL handling')
const dupes = parseM3u(`#EXTM3U
#EXTINF:-1,A
http://same/stream.ts
#EXTINF:-1,B
http://same/stream.ts
`)
check('duplicate urls get distinct ids', dupes.channels[0]!.externalId !== dupes.channels[1]!.externalId)

console.log('\nXtream URL builder')
check('strips trailing path', XtreamClient.normalizeBaseUrl('http://ex.com:8080/player_api.php') === 'http://ex.com:8080')
check('adds missing scheme', XtreamClient.normalizeBaseUrl('ex.com:8080') === 'http://ex.com:8080')
check('keeps https', XtreamClient.normalizeBaseUrl('https://ex.com:443/') === 'https://ex.com')

const client = new XtreamClient({ baseUrl: 'http://ex.com:8080', username: 'u ser', password: 'p@ss/word' })
check(
  'url-encodes credentials',
  client.liveStreamUrl('42') === 'http://ex.com:8080/live/u%20ser/p%40ss%2Fword/42.ts',
  client.liveStreamUrl('42')
)
check('vod uses container extension', client.vodStreamUrl('7', 'mkv').endsWith('/movie/u%20ser/p%40ss%2Fword/7.mkv'))

console.log('\nSearch folding')
check('strips accents', fold('Télé Événement') === 'tele evenement', fold('Télé Événement'))
check('collapses punctuation', fold('HARBOUR-SPORTS | HD') === 'harbour sports hd', fold('HARBOUR-SPORTS | HD'))

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
