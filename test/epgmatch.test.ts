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
  check('lowercases and splits', normalizeName('BBC One').join(',') === 'bbc,one')
  check('drops quality markers', normalizeName('Sky Sports HD').join(',') === 'sky,sports')
  check('drops several at once', normalizeName('Sky Sports FHD 1080p').join(',') === 'sky,sports')
  check(
    'splits on pipes and brackets',
    normalizeName('TR | beIN Sports 2 (Hat 1)').join(',') === 'tr,bein,sports,2',
    normalizeName('TR | beIN Sports 2 (Hat 1)')
  )
  // "Hat 1" is which feed, not which channel; keeping that 1 would make the
  // digit rule reject the correct guide entry.
  check('drops a feed qualifier and its number', !normalizeName('beIN Sports 2 (Hat 1)').includes('1'))
  check('drops other feed words too', normalizeName('CNN Backup 3').join(',') === 'cnn')
  check('but keeps a real channel number', normalizeName('beIN Sports 2').join(',') === 'bein,sports,2')
  check('strips accents', normalizeName('Kanal Türk').join(',') === 'turk', normalizeName('Kanal Türk'))
  check('keeps digits', normalizeName('beIN Sports 4').includes('4'))

  console.log('\nSimilarity')
  check('identical names score 1', similarity('BBC One', 'BBC One') === 1)
  check('quality suffixes do not matter', similarity('Sky Sports HD', 'Sky Sports') === 1)
  check('case and punctuation do not matter', similarity('BBC ONE!', 'bbc one') === 1)
  check('a prefix qualifier still matches well', similarity('TR | beIN Sports 2', 'beIN Sports 2') > ACCEPT_SCORE)
  check('a country suffix still matches', similarity('beIN Sports 2', 'beIN Sports 2 Turkey') > ACCEPT_SCORE)

  // The rule that matters most: numbers identify the channel.
  check('different numbers never match', similarity('beIN Sports 2', 'beIN Sports 4') === 0)
  check('even with identical words', similarity('Sky Sports 1 HD', 'Sky Sports 5 HD') === 0)
  check('a numbered and unnumbered name can still match', similarity('beIN Sports', 'beIN Sports 2') > 0)
  check('unrelated names score low', similarity('BBC One', 'Cartoon Network') < 0.4, similarity('BBC One', 'Cartoon Network'))

  console.log('\nPicking a match')
  const candidates = [
    { epgChannelId: 'bein2.tr', displayName: 'beIN Sports 2 HD' },
    { epgChannelId: 'bein4.tr', displayName: 'beIN Sports 4 HD' },
    { epgChannelId: 'bbc1.uk', displayName: 'BBC One' },
    { epgChannelId: 'cnn.us', displayName: 'CNN International' }
  ]

  check(
    'picks the right numbered channel',
    bestMatch('beIN Sports 2 (Hat 1)', candidates)?.epgChannelId === 'bein2.tr',
    bestMatch('beIN Sports 2 (Hat 1)', candidates)
  )
  check(
    'and not its neighbour',
    bestMatch('beIN Sports 4 (Hat 1)', candidates)?.epgChannelId === 'bein4.tr'
  )
  check('matches across quality suffixes', bestMatch('BBC One FHD', candidates)?.epgChannelId === 'bbc1.uk')
  check('returns nothing for an unrelated name', bestMatch('Discovery Science', candidates) === null)

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
  const ranked = rankCandidates('beIN Sports 2', candidates)
  check('best candidate is first', ranked[0]?.epgChannelId === 'bein2.tr', ranked[0])
  check('the wrong number is excluded entirely', !ranked.some((r) => r.epgChannelId === 'bein4.tr'))
  check('scores descend', ranked.every((r, i) => i === 0 || r.score <= ranked[i - 1]!.score))

  console.log('\nXMLTV channel declarations')
  const block = ' id="bein2.tr"><display-name>beIN Sports 2</display-name><icon src="http://x/2.png" />'
  const parsed = parseChannelBlock(block)
  check('reads the id', parsed?.id === 'bein2.tr')
  check('reads the display name', parsed?.displayName === 'beIN Sports 2')
  check('reads the icon', parsed?.iconUrl === 'http://x/2.png')
  check('rejects a block with no id', parseChannelBlock('><display-name>X</display-name>') === null)

  const DOC = `<?xml version="1.0"?>
<tv>
  <channel id="bein2.tr"><display-name>beIN Sports 2</display-name></channel>
  <channel id="bbc1.uk"><display-name>BBC One</display-name></channel>
  <programme start="20260906120000 +0000" stop="20260906130000 +0000" channel="bein2.tr"><title>Match</title></programme>
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
      mk('1', 'beIN Sports 2 (Hat 1)', 'wrong-id-2'),
      mk('2', 'beIN Sports 4 (Hat 1)', 'wrong-id-4'),
      mk('3', 'BBC One HD', ''),
      mk('4', 'Some Local Channel', 'local-1')
    ]
  )

  epgRepo.replaceGuideChannels(playlist.id, [
    { epgChannelId: 'bein2.tr', displayName: 'beIN Sports 2 HD', iconUrl: null },
    { epgChannelId: 'bein4.tr', displayName: 'beIN Sports 4 HD', iconUrl: null },
    { epgChannelId: 'bbc1.uk', displayName: 'BBC One', iconUrl: null }
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

  addProgramme('bein2.tr', 'Match of the Day')
  addProgramme('bein4.tr', 'Other Match')
  addProgramme('bbc1.uk', 'The News')

  check('nothing matches before the fix', epgRepo.coverage(playlist.id).matched === 0)
  check(
    'and the channel list shows no programme',
    catalog.queryChannels({ playlistId: playlist.id, limit: 10 }).every((c) => c.now === null)
  )

  const result = autoMatch(playlist.id)
  check('three channels were matched by name', result.matched === 3, result)
  check('the local channel could not be', result.ambiguous === 1, result)

  const after = epgRepo.matchRows(playlist.id, false)
  const bein2 = after.find((r) => r.channelName.includes('Sports 2'))!
  const bein4 = after.find((r) => r.channelName.includes('Sports 4'))!

  check('beIN 2 points at the right guide channel', bein2.overrideId === 'bein2.tr', bein2.overrideId)
  check('beIN 4 points at its own, not its neighbour', bein4.overrideId === 'bein4.tr', bein4.overrideId)
  check('a channel with no id at all was matched', after.find((r) => r.channelName.includes('BBC'))?.matched === true)
  check('the unmatched one is still reported', after.find((r) => r.channelName.includes('Local'))?.matched === false)

  // The whole point: programmes now reach the channel list.
  const rows = catalog.queryChannels({ playlistId: playlist.id, limit: 10 })
  check(
    'beIN 2 now shows its own programme',
    rows.find((c) => c.name.includes('Sports 2'))?.now?.title === 'Match of the Day',
    rows.find((c) => c.name.includes('Sports 2'))?.now
  )
  check(
    'and beIN 4 shows its own, not the same one',
    rows.find((c) => c.name.includes('Sports 4'))?.now?.title === 'Other Match'
  )
  check('coverage reflects the repair', epgRepo.coverage(playlist.id).matched === 3)

  console.log('\nManual overrides are respected')
  const local = after.find((r) => r.channelName.includes('Local'))!
  epgRepo.setOverride(local.channelId, 'bbc1.uk', false)

  const second = autoMatch(playlist.id)
  check('a re-run does not undo a manual choice', (() => {
    const row = epgRepo.matchRows(playlist.id, false).find((r) => r.channelId === local.channelId)!
    return row.overrideId === 'bbc1.uk' && !row.overrideAuto
  })(), second)

  epgRepo.setOverride(bein2.channelId, 'bein4.tr', false)
  check(
    'a manual override wins over the provider id',
    catalog.queryChannels({ playlistId: playlist.id, limit: 10 }).find((c) => c.name.includes('Sports 2'))
      ?.now?.title === 'Other Match'
  )

  epgRepo.setOverride(bein2.channelId, null, false)
  check(
    'clearing an override falls back to the provider id',
    epgRepo.matchRows(playlist.id, false).find((r) => r.channelId === bein2.channelId)?.matched === false
  )

  console.log('\nSuggestions')
  const suggestions = suggestionsFor(playlist.id, 'beIN Sports 2 (Hat 1)')
  check('the best suggestion is first', suggestions[0]?.epgChannelId === 'bein2.tr', suggestions[0])
  check('the wrong number is not suggested', !suggestions.some((s) => s.epgChannelId === 'bein4.tr'))
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
