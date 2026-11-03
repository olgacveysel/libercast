/**
 * The picture-in-picture control, clicked the way a person clicks it.
 *
 * This one cannot be driven from `executeJavaScript`. The browser refuses
 * `requestPictureInPicture` without a user gesture, and script that calls it
 * directly gets `NotAllowedError` — so a harness written that way would prove
 * only that the refusal works. The click here is a real mouse event delivered
 * through `sendInputEvent`, at the coordinates the button actually occupies.
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

const PIP_BUTTON = `[...document.querySelectorAll('.player button')]
  .find((b) => (b.getAttribute('aria-label') ?? '').toLowerCase().includes('picture in picture'))`

const state = () => `(() => {
  const button = ${PIP_BUTTON}
  const video = document.querySelector('.player__video')
  return {
    present: Boolean(button),
    label: button?.getAttribute('aria-label') ?? null,
    pressed: button?.getAttribute('aria-pressed') ?? null,
    inPip: Boolean(document.pictureInPictureElement),
    pipIsOurVideo: document.pictureInPictureElement === video,
    videoReady: video?.readyState ?? 0,
    playing: video ? !video.paused : false
  }
})()`

/** A real mouse press and release where the element sits. */
async function clickPipButton(window) {
  const box = await read(window, `(() => {
    const b = ${PIP_BUTTON}
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!box) return false

  window.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  window.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await settle(900)
  return true
}

async function main() {
  // A real file, because the element has to have decoded a frame before the
  // browser will pop it out.
  const work = mkdtempSync(join(tmpdir(), 'pip-'))
  const clip = join(work, 'clip.mp4')
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=d=30:s=320x240',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', clip
  ])

  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: { preload: join(__dirname, 'pip-preload.cjs'), sandbox: false }
  })

  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'), {
    search: `clip=${encodeURIComponent(`file://${clip}`)}`
  })
  await settle(1600)
  await read(window, `[...document.querySelectorAll('.navitem')]
    .find((b) => b.textContent.trim() === 'Live TV')?.click()`)
  await settle(900)
  await read(window, `document.querySelector('.chanrow')?.click()`)
  await settle(2200)

  console.log('\nBefore anything is clicked')
  let now = await read(window, state())
  check('the video is playing', now.playing === true && now.videoReady >= 2, now)
  check('the control is offered', now.present === true, now)
  check('it is not shown as active', now.pressed === 'false', now)
  check('and nothing is popped out yet', now.inPip === false, now)

  console.log('\nClicking it, with a real mouse event')
  const clicked = await clickPipButton(window)
  check('the button was found and pressed', clicked === true)
  now = await read(window, state())

  check('the video pops out', now.inPip === true, now)
  check('and it is this player, not some other element', now.pipIsOurVideo === true, now)
  // The state comes from the browser's own event, so this is also a check that
  // the hook listens rather than assuming its request succeeded.
  check('the button shows it is active', now.pressed === 'true', now)
  check('and offers to undo it', (now.label ?? '').toLowerCase().includes('leave'), now.label)

  console.log('\nClicking it again')
  await clickPipButton(window)
  now = await read(window, state())
  check('it comes back', now.inPip === false, now)
  check('the button is no longer active', now.pressed === 'false', now)
  check('and the video did not stop', now.playing === true, now)

  console.log('\nWhen the browser closes the window itself')
  // Exactly what happens on a channel change, a retry or a failover: the
  // source is replaced and the floating window goes with it. The button must
  // follow the browser rather than its own last instruction.
  await clickPipButton(window)
  now = await read(window, state())
  check('popped out again', now.inPip === true, now)

  await read(window, `document.exitPictureInPicture()`)
  await settle(800)
  now = await read(window, state())
  check('the button notices it was closed from elsewhere', now.pressed === 'false', now)
  check('and agrees with the browser', now.inPip === false, now)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  window.destroy()
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main)
