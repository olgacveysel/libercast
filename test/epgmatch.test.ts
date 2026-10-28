import { getDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import * as epgRepo from '@main/db/repo/epg'
import { autoMatch, suggestionsFor } from '@main/sources/epg'
import { ACCEPT_SCORE, bestMatch, normalizeName, rankCandidates, similarity } from '@main/sources/epgMatch'
import { parseChannelBlock, scanXmltv } from '@main/sources/xmltv'
import type { ParsedProgramme } from '@main/sources/types'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

async function main(): Promise<void> {
  console.log('\nName normalisation')
  check('lowercases and splits', normalizeName('Civic One').join(',') === 'civic,one')
  check('drops quality markers', normalizeName('Harbour Sports HD').join(',') === 'harbour,sports')
  check('drops several at once', normalizeName('Harbour Sports FHD 1080p').join(',') === 'harbour,sports')
  check(
    'splits on pipes and brackets',
    normalizeName('TR | Alto Sports 2 (Hat 1)').join(',') === 'tr,alto,sports,2',
    normalizeName('TR | Alto Sports 2 (Hat 1)')
  )
  // "Hat 1" is which feed, not which channel; keeping that 1 would make the
  // digit rule reject the correct guide entry.
  check('drops a feed qualifier and its number', !normalizeName('Alto Sports 2 (Hat 1)').includes('1'))
  check('drops other feed words too', normalizeName('Beacon Backup 3').join(',') === 'beacon')
  check('but keeps a real channel number', normalizeName('Alto Sports 2').join(',') === 'alto,sports,2')
  check('strips accents', normalizeName('Kanal Güneş').join(',') === 'gunes', normalizeName('Kanal Güneş'))
  check('keeps digits', normalizeName('Alto Sports 4').includes('4'))

  console.log('\nSimilarity')
  check('identical names score 1', similarity('Civic One', 'Civic One') === 1)
  check('quality suffixes do not matter', similarity('Harbour Sports HD', 'Harbour Sports') === 1)
  check('case and punctuation do not matter', similarity('CIVIC ONE!', 'civic one') === 1)
  check('a prefix qualifier still matches well', similarity('TR | Alto Sports 2', 'Alto Sports 2') > ACCEPT_SCORE)
  check('a country suffix still matches', similarity('Alto Sports 2', 'Alto Sports 2 Turkey') > ACCEPT_SCORE)

  // The rule that matters most: numbers identify the channel.
  check('different numbers never match', similarity('Alto Sports 2', 'Alto Sports 4') === 0)
  check('even with identical words', similarity('Harbour Sports 1 HD', 'Harbour Sports 5 HD') === 0)
  check('a numbered and unnumbered name can still match', similarity('Alto Sports', 'Alto Sports 2') > 0)
  check('unrelated names score low', similarity('Civic One', 'Cartoon Network') < 0.4, similarity('Civic One', 'Cartoon Network'))

  console.log('\nPicking a match')
  const candidates = [
    { epgChannelId: 'alto2.tr', displayName: 'Alto Sports 2 HD' },
    { epgChannelId: 'alto4.tr', displayName: 'Alto Sports 4 HD' },
    { epgChannelId: 'civic1.uk', displayName: 'Civic One' },
    { epgChannelId: 'beacon.us', displayName: 'Beacon International' }
  ]

  check(
    'picks the right numbered channel',
    bestMatch('Alto Sports 2 (Hat 1)', candidates)?.epgChannelId === 'alto2.tr',
    bestMatch('Alto Sports 2 (Hat 1)', candidates)
  )
  check(
    'and not its neighbour',
    bestMatch('Alto Sports 4 (Hat 1)', candidates)?.epgChannelId === 'alto4.tr'
  )
  check('matches across quality suffixes', bestMatch('Civic One FHD', candidates)?.epgChannelId === 'civic1.uk')
  // `bestMatch` has no acceptance floor of its own — it returns anything
  // scoring above zero and leaves the decision to `ACCEPT_SCORE` in the
  // caller. Any two English names share a bigram or two, so asserting null
  // here only ever passed because the fixture happened to share none; what
  // actually matters is that an unrelated name never clears the bar that
  // applies a match.
  const unrelated = bestMatch('Discovery Science', candidates)
  check(
    'an unrelated name never scores highly enough to be applied',
    unrelated === null || unrelated.score < ACCEPT_SCORE,
    unrelated
  )

  // Ambiguity guard: two equally plausible candidates must produce no guess.
  const twins = [
    { epgChannelId: 'a', displayName: 'Sports Channel Alpha' },
    { epgChannelId: 'b', displayName: 'Sports Channel Bravo' }
  ]
  check('refuses to guess between near-identical names', bestMatch('Sports Channel', twins) === null)
  check(
    'but an exact match wins even with a near twin',
    bestMatch('Sports Channel Alpha', twins)?.epgChannelId === 'a'
  )

  console.log('\nRanking for the override list')
  const ranked = rankCandidates('Alto Sports 2', candidates)
  check('best candidate is first', ranked[0]?.epgChannelId === 'alto2.tr', ranked[0])
  check('the wrong number is excluded entirely', !ranked.some((r) => r.epgChannelId === 'alto4.tr'))
  check('scores descend', ranked.every((r, i) => i === 0 || r.score <= ranked[i - 1]!.score))

  console.log('\nXMLTV channel declarations')
  const block = ' id="alto2.tr"><display-name>Alto Sports 2</display-name><icon src="http://x/2.png" />'
  const parsed = parseChannelBlock(block)
  check('reads the id', parsed?.id === 'alto2.tr')
  check('reads the display name', parsed?.displayName === 'Alto Sports 2')
  check('reads the icon', parsed?.iconUrl === 'http://x/2.png')
  check('rejects a block with no id', parseChannelBlock('><display-name>X</display-name>') === null)

  const DOC = `<?xml version="1.0"?>
<tv>
  <channel id="alto2.tr"><display-name>Alto Sports 2</display-name></channel>
  <channel id="civic1.uk"><display-name>Civic One</display-name></channel>
  <programme start="20260906120000 +0000" stop="20260906130000 +0000" channel="alto2.tr"><title>Match</title></programme>
</tv>`

  const seenChannels: { id: string; displayName: string }[] = []
  const seenProgrammes: ParsedProgramme[] = []

  async function* source(chunks: string[]): AsyncGenerator<string> {
    for (const chunk of chunks) yield chunk
  }

  await scanXmltv(source([DOC]), {
    onChannel: (channel) => seenChannels.push({ id: channel.id, displayName: channel.displayName }),
    onBatch: (batch) => seenProgrammes.push(...batch)
  })

  check('both channels are captured', seenChannels.length === 2, seenChannels)
  check('and the programme still is', seenProgrammes.length === 1)

  // Channels and programmes must both survive being cut across chunks.
  const fragments: string[] = []
  for (let i = 0; i < DOC.length; i += 6) fragments.push(DOC.slice(i, i + 6))

  const fragChannels: string[] = []
  const fragProgrammes: ParsedProgramme[] = []
  await scanXmltv(source(fragments), {
    onChannel: (channel) => fragChannels.push(channel.id),
    onBatch: (batch) => fragProgrammes.push(...batch)
  })
  check(`channels survive ${fragments.length} fragment boundaries`, fragChannels.length === 2, fragChannels)
  check('programmes survive too', fragProgrammes.length === 1, fragProgrammes.length)

  console.log('\nEnd to end against the database')
  getDb()
  const playlist = createPlaylist({ name: 'Provider', kind: 'xtream', url: 'http://x', username: 'u' })

  // Channels whose ids do not appear in the feed — the failure this fixes.
  importCatalog(
    playlist.id,
    'live',
    [{ externalId: 'sport', name: 'Sports' }],
    [
      mk('1', 'Alto Sports 2 (Hat 1)', 'wrong-id-2'),
      mk('2', 'Alto Sports 4 (Hat 1)', 'wrong-id-4'),
      mk('3', 'Civic One HD', ''),
      mk('4', 'Some Local Channel', 'local-1')
    ]
  )

  epgRepo.replaceGuideChannels(playlist.id, [
    { epgChannelId: 'alto2.tr', displayName: 'Alto Sports 2 HD', iconUrl: null },
    { epgChannelId: 'alto4.tr', displayName: 'Alto Sports 4 HD', iconUrl: null },
    { epgChannelId: 'civic1.uk', displayName: 'Civic One', iconUrl: null }
  ])

  const now = Date.now()
  const addProgramme = (id: string, title: string): void =>
    epgRepo.insertPrograms(playlist.id, [
      {
        channelId: id,
        title,
        description: null,
        category: null,
        startsAt: now - 600_000,
        endsAt: now + 600_000
      }
    ]) as unknown as void

  addProgramme('alto2.tr', 'Match of the Day')
  addProgramme('alto4.tr', 'Other Match')
  addProgramme('civic1.uk', 'The News')

  check('nothing matches before the fix', epgRepo.coverage(playlist.id).matched === 0)
  check(
    'and the channel list shows no programme',
    catalog.queryChannels({ playlistId: playlist.id, limit: 10 }).every((c) => c.now === null)
  )

  const result = autoMatch(playlist.id)
  check('three channels were matched by name', result.matched === 3, result)
  check('the local channel could not be', result.ambiguous === 1, result)

  const after = epgRepo.matchRows(playlist.id, false)
  const alto2 = after.find((r) => r.channelName.includes('Sports 2'))!
  const alto4 = after.find((r) => r.channelName.includes('Sports 4'))!

  check('Alto 2 points at the right guide channel', alto2.overrideId === 'alto2.tr', alto2.overrideId)
  check('Alto 4 points at its own, not its neighbour', alto4.overrideId === 'alto4.tr', alto4.overrideId)
  check('a channel with no id at all was matched', after.find((r) => r.channelName.includes('Civic'))?.matched === true)
  check('the unmatched one is still reported', after.find((r) => r.channelName.includes('Local'))?.matched === false)

  // The whole point: programmes now reach the channel list.
  const rows = catalog.queryChannels({ playlistId: playlist.id, limit: 10 })
  check(
    'Alto 2 now shows its own programme',
    rows.find((c) => c.name.includes('Sports 2'))?.now?.title === 'Match of the Day',
    rows.find((c) => c.name.includes('Sports 2'))?.now
  )
  check(
    'and Alto 4 shows its own, not the same one',
    rows.find((c) => c.name.includes('Sports 4'))?.now?.title === 'Other Match'
  )
  check('coverage reflects the repair', epgRepo.coverage(playlist.id).matched === 3)

  console.log('\nManual overrides are respected')
  const local = after.find((r) => r.channelName.includes('Local'))!
  epgRepo.setOverride(local.channelId, 'civic1.uk', false)

  const second = autoMatch(playlist.id)
  check('a re-run does not undo a manual choice', (() => {
    const row = epgRepo.matchRows(playlist.id, false).find((r) => r.channelId === local.channelId)!
    return row.overrideId === 'civic1.uk' && !row.overrideAuto
  })(), second)

  epgRepo.setOverride(alto2.channelId, 'alto4.tr', false)
  check(
    'a manual override wins over the provider id',
    catalog.queryChannels({ playlistId: playlist.id, limit: 10 }).find((c) => c.name.includes('Sports 2'))
      ?.now?.title === 'Other Match'
  )

  epgRepo.setOverride(alto2.channelId, null, false)
  check(
    'clearing an override falls back to the provider id',
    epgRepo.matchRows(playlist.id, false).find((r) => r.channelId === alto2.channelId)?.matched === false
  )

  console.log('\nSuggestions')
  const suggestions = suggestionsFor(playlist.id, 'Alto Sports 2 (Hat 1)')
  check('the best suggestion is first', suggestions[0]?.epgChannelId === 'alto2.tr', suggestions[0])
  check('the wrong number is not suggested', !suggestions.some((s) => s.epgChannelId === 'alto4.tr'))
}

function mk(externalId: string, name: string, epgChannelId: string) {
  return {
    externalId,
    name,
    categoryExternalId: 'sport',
    number: null,
    logoUrl: null,
    epgChannelId,
    streamUrl: `http://x/${externalId}.ts`,
    containerExtension: 'ts',
    isAdult: false
  }
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
