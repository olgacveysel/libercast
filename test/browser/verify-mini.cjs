/**
 * The corner player: does the stream actually survive leaving the screen?
 *
 * That is the whole claim, and it is the only thing worth testing here. A
 * mini player appearing proves nothing — a player that closed its session and
 * opened a new one looks identical on screen, and costs a provider connection
 * and a few seconds of black picture every time someone opens the guide.
 *
 * So this watches the video element's own clock across a route change, and
 * counts how many times the main process was asked to open a stream.
 *
 * Not part of `npm test`: needs a display (`xvfb-run`).
 */
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail === undefined ? '' : detail)
  }
}

const read = (w, script) => w.webContents.executeJavaScript(script)
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms))

const nav = (label) => `[...document.querySelectorAll('.navitem')]
  .find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`

const state = () => `(() => {
  const live = document.querySelector('.live')
  const video = document.querySelector('.live .player__video')
  return {
    classes: live ? live.className : null,
    mini: Boolean(live && live.classList.contains('live--mini')),
    full: Boolean(live && live.classList.contains('live--full')),
    hidden: Boolean(live && live.classList.contains('live--hidden')),
    bar: Boolean(document.querySelector('.minibar')),
    name: document.querySelector('.minibar__name')?.textContent?.trim() ?? null,
    time: video ? video.currentTime : null,
    playing: video ? !video.paused : false,
    hasSrc: Boolean(video && video.getAttribute('src')),
    opens: window.__probe.opens(),
    closes: window.__probe.closes()
  }
})()`

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'mini-'))
  const clip = join(work, 'clip.mp4')
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=d=60:s=320x240',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', clip
  ])

  const window = new BrowserWindow({
    width: 1400, height: 900, show: true,
    webPreferences: { preload: join(__dirname, 'mini-preload.cjs'), sandbox: false }
  })

  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'), {
    search: `clip=${encodeURIComponent(`file://${clip}`)}`
  })
  await settle(1600)
  await read(window, nav('Live TV'))
  await settle(900)
  await read(window, `document.querySelector('.chanrow')?.click()`)
  await settle(2400)

  console.log('\nWatching on the Live TV screen')
  let now = await read(window, state())
  check('it is playing', now.playing === true && now.time > 0, now)
  check('and drawn as the full screen', now.full === true, now.classes)
  check('with no corner chrome', now.bar === false, now)
  const opensAfterStart = now.opens
  check('one stream was opened', opensAfterStart === 1, now.opens)

  console.log('\nNavigating to the films grid')
  const before = now.time
  await read(window, nav('Movies'))
  await settle(1800)
  now = await read(window, state())

  check('the player follows as a corner window', now.mini === true, now.classes)
  check('the corner window names the channel', now.name === 'Alto Sports 2', now.name)
  // The point of the whole exercise.
  check('the same video is still playing', now.playing === true, now)
  check('and its clock moved on rather than restarting',
    now.time > before, { before, after: now.time })
  check('no second stream was opened', now.opens === opensAfterStart, now.opens)
  check('and the first was never closed', now.closes === 0, now.closes)

  console.log('\nGoing back')
  await read(window, `document.querySelector('.minibar__name')?.click()`)
  await settle(1200)
  const back = await read(window, state())
  check('the corner window returns to Live TV', back.full === true, back.classes)
  check('still without reopening anything', back.opens === opensAfterStart, back.opens)
  check('and still playing', back.playing === true, back)

  console.log('\nOn a screen that runs playback itself')
  // Multi-view opens its own streams. A corner window there would mean two
  // sessions at once, which an account allowing one connection simply refuses.
  await read(window, nav('Multi-view'))
  await settle(1400)
  now = await read(window, state())
  check('the corner window does not follow', now.mini === false, now.classes)
  check('and the stream is given up rather than held', now.closes > 0, now.closes)

  console.log('\nClosing it by hand')
  await read(window, nav('Live TV'))
  await settle(1500)
  await read(window, nav('Guide'))
  await settle(1400)
  now = await read(window, state())
  check('it followed again', now.mini === true, now.classes)

  await read(window, `document.querySelectorAll('.minibar__btn')[1]?.click()`)
  await settle(1200)
  now = await read(window, state())
  check('closing it puts the picture away', now.mini === false, now.classes)
  check('and stops the stream', now.hasSrc === false, now)

  console.log('\nAnd it stays closed until asked for again')
  await read(window, nav('Movies'))
  await settle(1000)
  now = await read(window, state())
  check('it does not reappear on the next screen', now.mini === false, now.classes)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  window.destroy()
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main)
