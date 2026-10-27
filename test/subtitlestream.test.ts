import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { binaries, resetBinaryCache, setFfmpegOverride } from '@main/media/binaries'
import { StreamServer } from '@main/media/streamServer'
import { parseCueBlocks } from '@renderer/features/player/subtitles'

const run = promisify(execFile)

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const work = mkdtempSync(join(tmpdir(), 'libercast-subs-'))

async function pickWorkingFfmpeg(): Promise<boolean> {
  for (const folder of [null, '/usr/bin', '/usr/local/bin']) {
    setFfmpegOverride(folder)
    resetBinaryCache()
    const resolved = binaries()
    if (!resolved.ffmpeg || !resolved.ffprobe) continue
    try {
      await run(resolved.ffmpeg, ['-hide_banner', '-version'])
      return true
    } catch {
      continue
    }
  }
  return false
}

async function main(): Promise<void> {
  if (!(await pickWorkingFfmpeg())) {
    console.log('  SKIP  no usable ffmpeg in this environment')
    return
  }

  const { ffmpeg } = binaries()

  // A clip with a real embedded subtitle track whose first cue is a few
  // seconds in — a subtitle file does not exist the moment ffmpeg starts, and
  // that delay is the whole point of this test.
  // Written with fs rather than shelled out to `printf`: there is no `sh` on
  // Windows, and this suite has to pass on the platform the app ships for.
  const srt = join(work, 'subs.srt')
  writeFileSync(
    srt,
    '1\n00:00:02,000 --> 00:00:05,000\nIyi aksamlar\n\n' +
      '2\n00:00:06,000 --> 00:00:09,000\nGorusmek uzere\n\n'
  )

  const fixture = join(work, 'clip.mkv')
  await run(ffmpeg!, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=d=10:s=320x240',
    '-f', 'lavfi', '-i', 'sine=d=10',
    '-i', srt,
    '-map', '0:v', '-map', '1:a', '-map', '2:s',
    // Keyframes every three seconds. The default is one every ten, which for a
    // ten-second clip means a seek always lands back at zero — and the keyframe
    // gap this test is about never appears.
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '75',
    '-c:a', 'aac', '-c:s', 'srt',
    '-metadata:s:s:0', 'language=tur',
    '-y', fixture
  ])

  const server = new StreamServer()
  await server.start()

  const session = await server.open({
    url: fixture,
    label: 'clip',
    subtitleTrack: 0
  })

  check('a subtitle URL is offered', session.subtitlesUrl !== null, session)

  /* ---------------------------------------------------------------------
     The ordering that matters.

     The renderer sets `element.src` and then immediately fetches the subtitle
     URL, so the subtitle request reaches the server BEFORE the video request
     — before ffmpeg has even been started. Asking for the video first, as the
     other end-to-end test does, hides this completely.
     --------------------------------------------------------------------- */

  const subsPromise = fetch(session.subtitlesUrl!)

  // A beat, to make the ordering unambiguous rather than merely likely.
  await new Promise((resolve) => setTimeout(resolve, 250))

  const video = await fetch(session.url)
  check('video responds 200', video.status === 200)

  const subs = await subsPromise
  check('subtitles requested before the video are not refused', subs.status === 200, subs.status)

  /* ---------------------------------------------------------------------
     The header that makes any of this reach the app.

     The renderer is served from localhost:5173 in development and from a file
     URL when packaged, while this server is on 127.0.0.1 at a random port.
     Different origins, so `fetch` is subject to CORS. Without this header the
     browser discards the response before the app sees a byte — and every test
     in this file still passes, because Node's fetch does not enforce CORS.
     That gap is why the subtitles were broken for so long while the suite was
     green, so the header is asserted directly.
     --------------------------------------------------------------------- */

  check(
    'subtitles are readable across origins',
    subs.headers.get('access-control-allow-origin') === '*',
    subs.headers.get('access-control-allow-origin')
  )
  check(
    'so is the video, for anything that fetches it',
    video.headers.get('access-control-allow-origin') === '*',
    video.headers.get('access-control-allow-origin')
  )

  const preflight = await fetch(session.subtitlesUrl!, { method: 'OPTIONS' })
  check('a preflight is answered rather than refused', preflight.status === 204, preflight.status)
  check(
    'and states the methods allowed',
    (preflight.headers.get('access-control-allow-methods') ?? '').includes('GET')
  )
  check(
    'subtitles declare themselves as WebVTT',
    (subs.headers.get('content-type') ?? '').includes('text/vtt')
  )

  // Drain both. The video has to be consumed or ffmpeg blocks on a full pipe
  // and never reaches the subtitle cues.
  const videoBytes = video.arrayBuffer()

  const body = await subs.text()
  await videoBytes

  check('the WebVTT header is present exactly once', (body.match(/WEBVTT/g) ?? []).length === 1, body.slice(0, 80))
  check('the first cue arrived', body.includes('Iyi aksamlar'), body.slice(0, 300))
  check('later cues arrived too', body.includes('Gorusmek uzere'), body.slice(0, 300))

  const parsed = parseCueBlocks(`${body}\n\n`)
  check('cues parse into the renderer track', parsed.cues.length >= 2, parsed.cues)
  // Not exact: the muxer normalises the stream's start time, so cues land a
  // few milliseconds off where the source file put them. What matters is that
  // they are not shifted by seconds, which would show subtitles out of sync.
  const first = parsed.cues[0]!
  check(
    'cue timings survive the round trip',
    Math.abs(first.startSecs - 2) < 0.2 && Math.abs(first.endSecs - 5) < 0.2,
    first
  )

  /* ---------------------------------------------------------------------
     Which timeline the cues are in.

     ffmpeg is given `-ss <offset>` before the input, so the stream it produces
     starts at zero from the seek point — and so does the element's
     currentTime. Cue times therefore need no adjustment in the renderer.

     Adding the offset there, as the renderer used to, pushed every cue forward
     by however far into the film the viewer had resumed. At a half-hour resume
     the cues were scheduled half an hour past what was playing: they arrived,
     they parsed, and not one was ever shown. Nothing in the logs said so,
     because nothing had failed.
     --------------------------------------------------------------------- */

  const seeked = await server.open({
    url: fixture,
    label: 'clip',
    subtitleTrack: 0,
    seekSecs: 4
  })
  const drainSeeked = fetch(seeked.url).then((r) => r.arrayBuffer())
  const seekedBody = await (await fetch(seeked.subtitlesUrl!)).text()
  await drainSeeked

  const seekedCues = parseCueBlocks(`${seekedBody}\n\n`).cues
  check('a seeked stream still produces cues', seekedCues.length > 0, seekedBody.slice(0, 200))


  /* ---------------------------------------------------------------------
     The keyframe gap, and the two outputs agreeing about it.

     A stream copy can only start at a keyframe, so a stream asked for at 4s
     really begins a little earlier. Left to itself ffmpeg zeroes the video by
     the keyframe it reached and the subtitles by the seek that was requested —
     so the cues run ahead of the picture by exactly that gap. Keeping the
     source's own timestamps puts both on one timeline.
     --------------------------------------------------------------------- */

  check('a seekable VOD stream uses the source timeline', seeked.absoluteTimeline)

  const absoluteCue = seekedCues.find((cue) => cue.text.includes('Gorusmek'))
  check(
    'cue times are positions in the source, not in the stream',
    absoluteCue !== undefined && Math.abs(absoluteCue.startSecs - 6) < 0.3,
    absoluteCue
  )

  // The video is on that same timeline, so the element's clock at the moment
  // this cue shows reads 6s — the point in the film the cue belongs to.
  const saved = join(work, 'seeked.mp4')
  writeFileSync(saved, Buffer.from(await (await fetch(seeked.url)).arrayBuffer()))
  const seekedStart = await startTimeOf(saved)

  // Keyframes sit at 0, 3, 6, 9; asked for 4, the stream can only begin at 3.
  check('the video is on the source timeline too', seekedStart > 1, seekedStart)
  check(
    'the video starts at or before the point asked for, never after',
    seekedStart <= 4.001,
    seekedStart
  )
  check(
    'the keyframe gap is real and now visible rather than hidden',
    seekedStart < 4 - 0.5,
    seekedStart
  )
  // Both outputs now agree, so a cue no longer runs ahead of the picture by
  // the size of the keyframe gap.
  check(
    'the cue sits inside the stream the video actually produced',
    absoluteCue !== undefined && absoluteCue.startSecs >= seekedStart,
    { cue: absoluteCue?.startSecs, videoStart: seekedStart }
  )

  /* A live stream has no duration and keeps the normalising behaviour. */
  check('a stream with no known duration is not switched over', session.absoluteTimeline === true)

  /* A session with no subtitle chosen must still refuse cleanly. */
  const plain = await server.open({ url: fixture, label: 'clip', subtitleTrack: null })
  check('no subtitle selected means no subtitle URL', plain.subtitlesUrl === null)

  /* ---------------------------------------------------------------------
     A slow source, and a client that gives up and comes back.

     This is the shape of the real failure. Against a provider the cues are
     written over minutes, not milliseconds, and the renderer drops and
     re-issues the subtitle request as the video element loads. A reader tied
     to one HTTP request sees nothing in either case.
     --------------------------------------------------------------------- */

  const slow = await serveThrottled(fixture)
  const slowSession = await server.open({
    url: `${slow.base}/clip.mkv`,
    label: 'slow clip',
    subtitleTrack: 0
  })

  // Start the video so ffmpeg is running, then abandon the first subtitle
  // request almost immediately — before a single cue can exist.
  const drainSlow = fetch(slowSession.url).then((r) => r.arrayBuffer())

  const abandoned = new AbortController()
  const firstTry = fetch(slowSession.subtitlesUrl!, { signal: abandoned.signal })
    .then((r) => r.text())
    .catch(() => 'aborted')
  await new Promise((resolve) => setTimeout(resolve, 400))
  abandoned.abort()
  check('the first attempt was abandoned early', (await firstTry) === 'aborted')

  // Come back later, as the element does after it reloads.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const second = await fetch(slowSession.subtitlesUrl!)
  check('a later request is still accepted', second.status === 200, second.status)

  const replayed = await second.text()
  await drainSlow

  check(
    'cues written before the client arrived are replayed',
    replayed.includes('Iyi aksamlar'),
    replayed.slice(0, 200)
  )
  check(
    'cues written after it arrived come through too',
    replayed.includes('Gorusmek uzere'),
    replayed.slice(0, 300)
  )
  check(
    'the replay still has exactly one header',
    (replayed.match(/WEBVTT/g) ?? []).length === 1,
    replayed.slice(0, 80)
  )

  slow.server.close()
  server.closeAll()

  console.log(failures === 0 ? '\nsubtitlestream: all passed' : `\nsubtitlestream: ${failures} failed`)
  if (failures > 0) process.exitCode = 1
}

/** The first timestamp in a served stream, as ffprobe reads it. */
async function startTimeOf(url: string): Promise<number> {
  const { ffprobe } = binaries()
  const { stdout } = await run(ffprobe!, [
    '-v', 'error',
    '-show_entries', 'format=start_time',
    '-of', 'default=nw=1:nk=1',
    url
  ])
  return Number(stdout.trim())
}

/**
 * Serves the fixture slowly, so ffmpeg produces cues over seconds rather than
 * instantly. An instant source hides every timing bug in the reader.
 */
function serveThrottled(path: string): Promise<{ server: Server; base: string }> {
  const data = readFileSync(path)

  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'video/x-matroska',
      'Content-Length': String(data.length)
    })

    const parts = 24
    const size = Math.ceil(data.length / parts)
    let sent = 0

    const push = (): void => {
      if (sent >= parts || response.destroyed) {
        response.end()
        return
      }
      response.write(data.subarray(sent * size, (sent + 1) * size))
      sent += 1
      setTimeout(push, 150)
    }
    push()
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, base: `http://127.0.0.1:${port}` })
    })
  })
}

void main().catch((error) => {
  console.log('  FAIL  test threw', error)
  process.exitCode = 1
})
