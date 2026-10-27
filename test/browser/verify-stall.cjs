/**
 * Stall recovery, against a stream that really does stop.
 *
 * `test/stall.test.ts` feeds the detector made-up samples. What it cannot show
 * is the thing the detector exists for: that a provider which stops sending
 * data produces NO error event at all — not `error`, not `ended`, not
 * `stalled` — so a player waiting to be told has already lost. This serves
 * real fragmented MP4 over a real socket, stops writing halfway through, and
 * asks Chromium what it noticed.
 *
 * Not part of `npm test`: needs a display (`xvfb-run`) and takes ~20 seconds.
 */
const { app, BrowserWindow } = require('electron')
const { createServer } = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const { createStallWatch, STALL_AFTER_MS } = require(
  join(__dirname, '..', '..', 'node_modules', '.cache', 'verify-stall', 'stall.cjs')
)

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail === undefined ? '' : detail)
  }
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'libercast-stall-'))
  const clip = join(work, 'clip.mp4')

  // Fragmented MP4, because that is what the stream server pipes to the
  // element: playable as it arrives, with no index at the end.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=d=30:s=320x240', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-g', '30', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-y', clip])

  const bytes = readFileSync(clip)

  // Writes the first third, then goes quiet forever without closing: exactly
  // what a provider dropping a live stream looks like from this side.
  let held = null
  const media = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'video/mp4' })
    response.write(bytes.subarray(0, Math.floor(bytes.length / 3)))
    held = response
  })
  await new Promise((resolve) => media.listen(0, '127.0.0.1', resolve))
  const port = media.address().port

  const window = new BrowserWindow({ width: 640, height: 480, show: false })
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<meta charset="utf-8">
<video id="v" autoplay muted playsinline src="http://127.0.0.1:${port}/clip.mp4"></video>
<script>
  window.events = []
  for (const name of ['error', 'ended', 'stalled', 'waiting', 'suspend', 'abort', 'emptied']) {
    document.getElementById('v').addEventListener(name, () => window.events.push(name))
  }
</script>`))

  const read = () =>
    window.webContents.executeJavaScript(`(() => {
      const v = document.getElementById('v')
      return { currentTime: v.currentTime, paused: v.paused, ended: v.ended,
               seeking: v.seeking, readyState: v.readyState, events: window.events.slice() }
    })()`)

  // Wait for it to actually start, so what follows is a stall and not a
  // failure to open.
  const startedBy = Date.now() + 10_000
  let started = null
  while (Date.now() < startedBy) {
    const sample = await read()
    if (sample.currentTime > 0.1) {
      started = sample
      break
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  check('the stream really started playing', started !== null, started)
  if (started === null) return finish(media, window)

  const watch = createStallWatch(Date.now())
  let detectedAt = null
  let movedWhilePlaying = false
  let lastTime = started.currentTime
  let movedAt = Date.now()
  let final = started

  const deadline = Date.now() + STALL_AFTER_MS + 12_000
  while (Date.now() < deadline) {
    const sample = await read()
    final = sample
    if (sample.currentTime > lastTime + 0.05) {
      movedWhilePlaying = true
      movedAt = Date.now()
    }
    lastTime = Math.max(lastTime, sample.currentTime)

    if (watch.observe({ ...sample, at: Date.now() }) && detectedAt === null) {
      detectedAt = Date.now()
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  check('it played for a while before freezing', movedWhilePlaying)
  check('the stall was detected', detectedAt !== null, final)

  // The whole reason this exists. If Chromium reported the failure, a player
  // could just listen for it — and for the first year of this app's life, that
  // is what it did, and channels froze.
  check('no error event ever fired', !final.events.includes('error'), final.events)
  check('and the element never said it had ended', !final.events.includes('ended'), final.events)
  check('the picture is simply stuck', final.paused === false && final.ended === false, final)
  // An over-eager detector would reconnect through every ordinary rebuffer,
  // costing a connection each time, so being late is far safer than early.
  const waited = detectedAt === null ? 0 : detectedAt - movedAt
  check('it waited the full grace period before giving up', waited >= STALL_AFTER_MS,
    `${waited}ms after the last frame, threshold ${STALL_AFTER_MS}ms`)
  check('and did not sit on it much longer than that', waited < STALL_AFTER_MS + 3000, waited)

  finish(media, window)
}

function finish(media, window) {
  try {
    media.close()
    window.destroy()
  } catch {
    /* shutting down */
  }
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
