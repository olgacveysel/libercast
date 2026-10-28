import { createServer, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import { setSettings } from '@main/db/repo/settings'
import { binaries, resetBinaryCache } from '@main/media/binaries'
import { openStream } from '@main/media/openStream'
import { streamServer } from '@main/media/streamServer'
import { findAlternates, narrowingTerm, rankAlternates } from '@main/sources/failover'

const run = promisify(execFile)

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const work = mkdtempSync(join(tmpdir(), 'libercast-failover-'))

/** Which URLs each fake provider was asked for, so a retry can be caught. */
const asked: Record<string, string[]> = { good: [], dead: [] }

function provider(name: 'good' | 'dead', clip: Buffer | null): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      asked[name]!.push(request.url ?? '')

      if (clip === null) {
        // What a panel actually does when an account is out of connections:
        // an HTML page with a 200-ish shape, not a clean network error.
        response.writeHead(403, { 'Content-Type': 'text/html' })
        response.end('<html><body>Account is on maximum connections</body></html>')
        return
      }

      response.writeHead(200, { 'Content-Type': 'video/mp2t' })
      response.end(clip)
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function main(): Promise<void> {
  console.log('\nNarrowing before scoring')

  // Scoring every channel of every other provider would read tens of thousands
  // of rows per failover, so the longest identifying word narrows it first.
  check('the longest real word is used', narrowingTerm('Alto Sports 2 HD') === 'sports')
  check('numbers are never the narrowing term', narrowingTerm('KTV 1') === null)
  check('short words are not worth narrowing on', narrowingTerm('TV 5') === null)
  check('quality markers are not used', narrowingTerm('Civic One HD') !== 'hd', narrowingTerm('Civic One HD'))

  console.log('\nRanking what the other providers carry')

  const candidates = [
    { channelId: 10, playlistId: 2, playlistName: 'Backup', name: 'ALTO SPORTS 2' },
    { channelId: 11, playlistId: 2, playlistName: 'Backup', name: 'Alto Sports 4 HD' },
    { channelId: 12, playlistId: 3, playlistName: 'Third', name: 'TR | Alto Sports 2 (Hat 1)' },
    { channelId: 13, playlistId: 2, playlistName: 'Backup', name: 'Lumen Channel' }
  ]
  const ranked = rankAlternates('Alto Sports 2 HD', candidates)

  check('the same channel elsewhere is found', ranked.length === 2, ranked)
  // The single most important rule here: failing over onto the wrong match of
  // the same competition is worse than showing no picture at all.
  check('a different channel number is never a fallback',
    ranked.every((r) => r.channelId !== 11), ranked)
  check('an unrelated channel is not a fallback',
    ranked.every((r) => r.channelId !== 13), ranked)
  check('the closest name comes first', ranked[0]?.channelId === 10, ranked)
  check('a channel already known dead is skipped',
    rankAlternates('Alto Sports 2 HD', candidates, [10])[0]?.channelId === 12)
  check('excluding everything leaves nothing',
    rankAlternates('Alto Sports 2 HD', candidates, [10, 12]).length === 0)

  console.log('\nAgainst two real providers, one of them broken')

  resetBinaryCache()
  const { ffmpeg } = binaries()
  if (!ffmpeg) {
    console.log('  SKIP  no usable ffmpeg in this environment')
    console.log(failures === 0 ? '\nfailover: all passed' : `\nfailover: ${failures} failed`)
    process.exit(failures === 0 ? 0 : 1)
  }

  const fixture = join(work, 'clip.ts')
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=d=4:s=320x240',
    '-f', 'lavfi', '-i', 'sine=d=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-y', fixture
  ])
  const clip = readFileSync(fixture)

  const dead = await provider('dead', null)
  const good = await provider('good', clip)
  const deadPort = (dead.address() as AddressInfo).port
  const goodPort = (good.address() as AddressInfo).port

  getDb()
  setSettings({ sourceFailover: true })

  const main1 = createPlaylist({ name: 'Main provider', kind: 'm3u', url: 'http://m3u/1' })
  const backup = createPlaylist({ name: 'Backup provider', kind: 'm3u', url: 'http://m3u/2' })

  const channel = (externalId: string, name: string, port: number) => ({
    externalId,
    name,
    categoryExternalId: null,
    number: null,
    logoUrl: null,
    epgChannelId: null,
    streamUrl: `http://127.0.0.1:${port}/${externalId}.ts`,
    containerExtension: 'ts',
    isAdult: false
  })

  importCatalog(main1.id, 'live', [], [
    channel('a-alto2', 'Alto Sports 2 HD', deadPort),
    channel('a-alto4', 'Alto Sports 4 HD', deadPort),
    channel('a-only', 'Channel Nobody Else Has', deadPort)
  ])
  importCatalog(backup.id, 'live', [], [
    channel('b-alto2', 'ALTO SPORTS 2', goodPort),
    // Deliberately no Alto 2 counterpart for the 4: the digit rule has to stop
    // a fallback onto a different match.
    channel('b-other', 'Lumen Channel', goodPort)
  ])

  const all = catalog.queryChannels({ playlistId: main1.id, kind: 'live', limit: 50 })
  const alto2 = all.find((c) => c.name === 'Alto Sports 2 HD')!
  const alto4 = all.find((c) => c.name === 'Alto Sports 4 HD')!
  const lonely = all.find((c) => c.name === 'Channel Nobody Else Has')!

  const found = findAlternates(alto2.id)
  check('the backup copy is found through the database', found.length === 1, found)
  check('and it names the provider it came from', found[0]?.playlistName === 'Backup provider', found)
  check('a channel with no counterpart finds none', findAlternates(lonely.id).length === 0)
  check('and neither does one whose number only exists here',
    findAlternates(alto4.id).length === 0, findAlternates(alto4.id))

  console.log('\nOpening through a dead source')

  const outcome = await openStream({ source: { type: 'channel', id: alto2.id }, owner: 'test' })
  check('it played', outcome.session.url.startsWith('http://127.0.0.1'), outcome.session.url)
  check('from the backup, not the source that refused',
    outcome.playingChannelId !== alto2.id, outcome.playingChannelId)
  check('the switch is reported', outcome.switched !== null, outcome.switched)
  check('it names the source that failed', outcome.switched?.from === 'Main provider', outcome.switched)
  check('and the one that took over', outcome.switched?.to === 'Backup provider', outcome.switched)
  check('the dead provider really was tried first', asked.dead.length > 0, asked)
  check('and the working one really served it', asked.good.length > 0, asked)
  streamServer.close(outcome.session.id)

  console.log('\nWhen the first source must not be tried again')

  const before = asked.dead.length
  const second = await openStream({
    source: { type: 'channel', id: alto2.id },
    owner: 'test',
    exclude: [alto2.id]
  })
  check('a channel already known dead is skipped entirely', asked.dead.length === before, asked.dead.length)
  check('and it still plays', second.playingChannelId !== alto2.id, second.playingChannelId)
  check('the switch is still reported', second.switched !== null, second.switched)
  streamServer.close(second.session.id)

  console.log('\nWhen there is nothing to fall back to')

  // Unchanged behaviour, and deliberately so: ffmpeg is more tolerant than
  // ffprobe, and a panel that answers the probe badly often streams fine. With
  // nothing else to try, playing through and carrying the explanation beats
  // refusing on the strength of a pre-flight check.
  const alone = await openStream({ source: { type: 'channel', id: lonely.id }, owner: 'test' })
  check('a channel with no alternate is still played', alone.session.url.length > 0)
  check('nothing is reported as switched', alone.switched === null, alone.switched)
  check('but the refusal is carried as a warning', alone.session.warning !== null, alone.session.warning)
  check('and the warning says what the provider said',
    alone.session.warning?.includes('403') === true, alone.session.warning)
  streamServer.close(alone.session.id)

  console.log('\nWith failover turned off')

  setSettings({ sourceFailover: false })
  const askedBefore = asked.good.length
  const off = await openStream({ source: { type: 'channel', id: alto2.id }, owner: 'test' })
  check('the other provider is never contacted', asked.good.length === askedBefore, asked.good.length)
  check('the dead source is played through, as it was before failover existed',
    off.switched === null && off.session.warning !== null, off)
  streamServer.close(off.session.id)

  streamServer.closeAll()
  dead.close()
  good.close()

  console.log(failures === 0 ? '\nfailover: all passed' : `\nfailover: ${failures} failed`)
  process.exit(failures === 0 ? 0 : 1)
}

void main().catch((error) => {
  console.error('\nTest run threw:', error)
  process.exit(1)
})
