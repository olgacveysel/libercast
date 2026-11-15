import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, statSync, createWriteStream } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { downloader, extensionFor, safeFileName } from '@main/media/downloader'
import * as repo from '@main/db/repo/downloads'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import { getDb } from '@main/db'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const work = mkdtempSync(join(tmpdir(), 'libercast-dl-'))

/**
 * Stands in for a provider: serves one file, honours range requests, and can be
 * told to drop the connection part-way so a resume can be exercised.
 */
interface Fixture {
  server: Server
  url: string
  /** Bytes to send before hanging up. 0 means serve the whole file. */
  cutAfter: number
  requests: { range: string | null; status: number }[]
  /** When true, range headers are ignored and the whole file is resent. */
  ignoreRanges: boolean
}

function serve(filePath: string): Promise<Fixture> {
  const body = readFileSync(filePath)

  const fixture: Fixture = {
    server: createServer((request, response) => {
      const range = request.headers.range ?? null
      let start = 0

      if (range && !fixture.ignoreRanges) {
        const match = /bytes=(\d+)-/.exec(range)
        if (match) start = Number(match[1])
      }

      const slice = body.subarray(start)
      const status = range && !fixture.ignoreRanges && start > 0 ? 206 : 200
      fixture.requests.push({ range, status })

      const headers: Record<string, string> = {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(slice.length)
      }
      if (status === 206) {
        headers['Content-Range'] = `bytes ${start}-${body.length - 1}/${body.length}`
      }

      response.writeHead(status, headers)

      if (fixture.cutAfter > 0) {
        // Send a prefix and then hang up, the way a dropped connection behaves.
        response.write(slice.subarray(0, fixture.cutAfter))
        setTimeout(() => response.destroy(), 30)
        return
      }

      response.end(slice)
    }),
    url: '',
    cutAfter: 0,
    requests: [],
    ignoreRanges: false
  }

  return new Promise((resolve) => {
    fixture.server.listen(0, '127.0.0.1', () => {
      const { port } = fixture.server.address() as AddressInfo
      fixture.url = `http://127.0.0.1:${port}/movie.mp4`
      resolve(fixture)
    })
  })
}

/**
 * The transfer half of the downloader, isolated from Electron and the database
 * so the resume behaviour itself can be asserted.
 */
/**
 * The watchdog half of `Downloader.transfer`, in isolation.
 *
 * Same shape as the real one — a timer reset by every chunk, destroying the
 * source on silence — exercised here against a server that sends one buffer
 * and then stops. The real one cannot be reached without Electron, a queue
 * and a provider; this is the part with the behaviour in it.
 */
async function transferWithWatchdog(url: string, target: string, stallMs: number): Promise<void> {
  const response = await fetch(url)
  if (!response.body) throw new Error('no body')

  const source = Readable.fromWeb(response.body as never)
  const sink = createWriteStream(target)

  let idle: ReturnType<typeof setTimeout> | undefined
  const bump = (): void => {
    clearTimeout(idle)
    idle = setTimeout(() => source.destroy(new Error('The provider stopped sending')), stallMs)
  }
  bump()
  source.on('data', bump)

  try {
    await pipeline(source, sink)
  } finally {
    clearTimeout(idle)
  }
}

async function transfer(url: string, target: string): Promise<{ status: number; bytes: number }> {
  let startAt: number
  try {
    startAt = statSync(target).size
  } catch {
    startAt = 0
  }

  const headers: Record<string, string> = {}
  if (startAt > 0) headers['Range'] = `bytes=${startAt}-`

  const response = await fetch(url, { headers })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)

  const honoured = startAt > 0 && response.status === 206
  const append = honoured

  await pipeline(
    Readable.fromWeb(response.body as never),
    createWriteStream(target, { flags: append ? 'a' : 'w' })
  )

  return { status: response.status, bytes: statSync(target).size }
}

function sha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function main(): Promise<void> {
  console.log('\nFile naming')
  check('joins title and subtitle', safeFileName('Breaking Bad', 'S02E05 Breakage', 'mkv') === 'Breaking Bad - S02E05 Breakage.mkv')
  check('omits a missing subtitle', safeFileName('Arrival', null, 'mp4') === 'Arrival.mp4')
  check(
    'strips characters Windows rejects',
    // Separators become spaces rather than disappearing, so the words either
    // side of them stay words. The rest are simply not legal anywhere.
    safeFileName('A: B/C\\D?E*F"G<H>I|J', null, 'mp4') === 'A B C DEFGHI J.mp4',
    safeFileName('A: B/C\\D?E*F"G<H>I|J', null, 'mp4')
  )
  check('never produces an empty name', safeFileName('///', null, 'mp4') === 'Download.mp4')
  check('caps runaway titles', safeFileName('x'.repeat(400), null, 'mp4').length < 160)

  check('reads an extension from a plain url', extensionFor('http://h/movie/u/p/1.mkv') === 'mkv')
  check('reads an extension before a query string', extensionFor('http://h/1.avi?token=x') === 'avi')
  check('falls back to mp4', extensionFor('http://h/stream') === 'mp4')

  console.log('\nQueue bookkeeping')
  getDb()
  const db = getDb()
  db.prepare(
    `INSERT INTO playlists (name, kind, url, epg_offset_min, enabled, sort_order, created_at)
     VALUES ('P', 'xtream', 'http://x', 0, 1, 0, ?)`
  ).run(Date.now())
  db.prepare(
    `INSERT INTO channels (playlist_id, external_id, kind, name, name_folded, stream_url, added_at, seen_at)
     VALUES (1, 'vod:1', 'movie', 'Arrival', 'arrival', 'http://x/1.mkv', ?, ?)`
  ).run(Date.now(), Date.now())

  const first = repo.createDownload({
    itemType: 'movie',
    itemId: 1,
    channelId: 1,
    playlistId: 1,
    title: 'Arrival',
    subtitle: null,
    posterUrl: null
  })
  check('queues a new item', first.status === 'queued')

  const again = repo.createDownload({
    itemType: 'movie',
    itemId: 1,
    channelId: 1,
    playlistId: 1,
    title: 'Arrival',
    subtitle: null,
    posterUrl: null
  })
  check('queueing the same item twice reuses the row', again.id === first.id)

  repo.updateDownload(first.id, { status: 'downloading' })
  check('running downloads are counted', repo.countRunning() === 1)
  check('running downloads are not handed out again', repo.nextQueued(5).length === 0)

  repo.updateDownload(first.id, { status: 'completed', filePath: '/tmp/a.mkv' })
  const requeued = repo.createDownload({
    itemType: 'movie',
    itemId: 1,
    channelId: 1,
    playlistId: 1,
    title: 'Arrival',
    subtitle: null,
    posterUrl: null
  })
  check('a completed item is not re-downloaded', requeued.status === 'completed')
  check('completed paths are exposed for offline playback', repo.completedPaths().get('movie:1') === '/tmp/a.mkv')

  repo.updateDownload(first.id, { status: 'downloading' })
  const recovered = repo.reconcileOnStartup()
  check('a crash leaves nothing marked as downloading', recovered === 1, recovered)
  check('interrupted downloads become paused, not failed', repo.getDownload(first.id)?.status === 'paused')

  console.log('\nResume against a real range server')

  // 3 MB of random bytes: incompressible, so a truncated copy cannot
  // accidentally match the whole file.
  const source = join(work, 'source.bin')
  writeFileSync(source, randomBytes(3 * 1024 * 1024))
  const expected = sha(source)

  const fixture = await serve(source)
  const target = join(work, 'movie.mp4')

  // First attempt: the connection dies after 1 MB.
  fixture.cutAfter = 1024 * 1024
  let partial = 0
  try {
    await transfer(fixture.url, target)
  } catch {
    partial = statSync(target).size
  }
  check(`first attempt wrote a partial file (${(partial / 1024).toFixed(0)} KB)`, partial > 0 && partial < 3 * 1024 * 1024, partial)
  check('the partial file is not the whole thing', sha(target) !== expected)

  // Second attempt: the server behaves, and the client asks to resume.
  fixture.cutAfter = 0
  const resumed = await transfer(fixture.url, target)
  check('the resume used a range request', resumed.status === 206, resumed.status)
  check(
    'the range asked for exactly the missing bytes',
    fixture.requests.at(-1)?.range === `bytes=${partial}-`,
    fixture.requests.at(-1)?.range
  )
  check('the finished file is the right size', resumed.bytes === 3 * 1024 * 1024, resumed.bytes)
  check('the resumed file is byte-identical to the source', sha(target) === expected)

  // A provider that ignores ranges must not corrupt the file by appending.
  const target2 = join(work, 'ignored.mp4')
  fixture.cutAfter = 512 * 1024
  try {
    await transfer(fixture.url, target2)
  } catch {
    /* expected */
  }
  const partial2 = statSync(target2).size
  check('second fixture produced a partial file', partial2 > 0 && partial2 < 3 * 1024 * 1024)

  fixture.cutAfter = 0
  fixture.ignoreRanges = true
  const restarted = await transfer(fixture.url, target2)
  check('a server ignoring the range answers 200', restarted.status === 200)
  check(
    'the file is rewritten rather than appended to',
    restarted.bytes === 3 * 1024 * 1024,
    restarted.bytes
  )
  check('the restarted file is still byte-identical', sha(target2) === expected)

  /*
   * Cancelling in the first moments.
   *
   * `drain` claims the slot with a placeholder job before `run` is launched,
   * and `run` used to replace that placeholder with a freshly built object.
   * `pause` and `cancel` find the job by id and set their flag on whatever is
   * in the map at that instant — so a cancel during the first second, while
   * the provider was still being asked for a URL, set it on an object `run`
   * was about to discard. The transfer carried on to the end, and the row
   * said cancelled.
   *
   * The resolve has to succeed for this to test anything: it is the step the
   * cancel arrives during, and only a download that gets past it reaches the
   * transfer the cancel was supposed to stop. With the flags lost, this
   * download runs to completion and the row says `completed` — the user
   * pressed cancel and got the file anyway.
   */
  console.log('\nCancelling a download before it starts')

  // M3U, so the channel's own URL is the stream and resolving it needs no
  // provider round trip — the resolve has to *succeed* for this to test
  // anything. Pointed at the fixture server, which is a real 3 MB file.
  const playlist = createPlaylist({ name: 'Provider', kind: 'm3u', url: 'http://x/list.m3u' })
  importCatalog(
    playlist.id,
    'live',
    [{ externalId: 'c', name: 'Films' }],
    [
      {
        externalId: '1',
        name: 'A Film',
        categoryExternalId: 'c',
        number: null,
        logoUrl: null,
        epgChannelId: null,
        streamUrl: fixture.url,
        containerExtension: 'ts',
        isAdult: false
      }
    ]
  )

  const channel = catalog.queryChannels({ playlistId: playlist.id, limit: 1 })[0]!
  const queued = downloader.enqueue({
    itemType: 'movie',
    itemId: channel.id,
    channelId: channel.id,
    title: 'A Film'
  })

  // Same tick: `run` has not had a chance to get past its first await.
  downloader.cancel(queued.id)

  // Long enough for the resolve to fail and the row to be written.
  await new Promise((resolve) => setTimeout(resolve, 300))

  const settled = repo.getDownload(queued.id)
  check(
    'a download cancelled at once does not run to completion',
    settled?.status !== 'completed',
    settled?.status
  )
  check('and is reported as cancelled', settled?.status === 'cancelled', settled?.status)
  check('with no leftover error', settled?.error == null, settled?.error)

  /*
   * A provider that goes quiet partway.
   *
   * `pipeline` waits on the source, the source waits on a socket the provider
   * has abandoned, and nothing timed it out: the row said `downloading` for
   * ever, the slot was never freed, and everything queued behind it waited
   * with it. The watchdog is reset by every chunk, so only a silence trips it
   * — a slow download is not a stalled one.
   */
  console.log('\nA transfer that stops receiving')

  const stalling = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    res.write(Buffer.alloc(64 * 1024))
    // ...and then nothing. The socket stays open.
  })
  await new Promise<void>((resolve) => stalling.listen(0, '127.0.0.1', resolve))
  const stallingUrl = `http://127.0.0.1:${(stalling.address() as AddressInfo).port}/x.ts`

  const stallTarget = join(work, 'stalled.bin')
  let stallError: string | null = null
  const stallStarted = Date.now()
  try {
    await transferWithWatchdog(stallingUrl, stallTarget, 400)
  } catch (error) {
    stallError = error instanceof Error ? error.message : String(error)
  }
  const stallElapsed = Date.now() - stallStarted

  check('a silent provider is given up on', stallError !== null, stallError)
  check('and it says what happened', stallError?.includes('stopped sending') === true, stallError)
  check('without waiting out a whole download', stallElapsed < 5000, stallElapsed)
  check('the partial file is kept, so it can resume', statSync(stallTarget).size > 0)

  stalling.close()
  fixture.server.close()
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
