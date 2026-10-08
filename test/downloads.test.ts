import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, statSync, createWriteStream } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extensionFor, safeFileName } from '@main/media/downloader'
import * as repo from '@main/db/repo/downloads'
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
async function transfer(url: string, target: string): Promise<{ status: number; bytes: number }> {
  let startAt = 0
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
    safeFileName('A: B/C\\D?E*F"G<H>I|J', null, 'mp4') === 'A BCDEFGHIJ.mp4',
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
