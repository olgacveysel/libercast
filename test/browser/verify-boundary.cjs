/**
 * A screen that fails must not take the application with it.
 *
 * React unmounts the whole tree when a render throws and nothing catches it.
 * That does not leave a broken screen — it leaves a blank window: no sidebar,
 * no menu, no way back, nothing on screen to suggest what happened. Found by
 * walking the application with a provider answering in an unexpected shape,
 * which blanked it on the first screen that mapped over the answer.
 *
 * So this drives the real interface into that failure and checks that the
 * rest of it is still there and still works.
 *
 * Not part of `npm test`: needs a display (`xvfb-run`).
 */
const { app, BrowserWindow } = require('electron')
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
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms))

const nav = (label) => `(() => {
  const item = [...document.querySelectorAll('.navitem')]
    .find((b) => b.textContent.trim() === ${JSON.stringify(label)})
  if (!item) return false
  item.click()
  return true
})()`

const state = () => `(() => ({
  mounted: (document.getElementById('root')?.innerHTML.length ?? 0) > 0,
  navItems: document.querySelectorAll('.navitem').length,
  failed: !!document.querySelector('.screenfail'),
  retry: !!document.querySelector('.screenfail .btn--primary'),
  message: document.querySelector('.screenfail__detail code')?.textContent ?? null,
  posters: document.querySelectorAll('.poster').length
}))()`

async function main() {
  const window = new BrowserWindow({
    width: 1400, height: 900, show: true,
    webPreferences: { preload: join(__dirname, 'boundary-preload.cjs'), sandbox: false }
  })
  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'))
  await settle(1800)

  let now = await read(window, state())
  check('the application starts', now.mounted && now.navItems > 0, now)

  console.log('\nOpening the screen that fails')
  check('the Guide is reachable', await read(window, nav('Guide')))
  await settle(1200)

  now = await read(window, state())
  // The regression, in one line: this used to be false.
  check('the application is still mounted', now.mounted, now)
  check('the sidebar is still there', now.navItems > 0, now)
  check('the failure is shown rather than a blank window', now.failed, now)
  check('and it offers a way to try again', now.retry, now)
  check('and says what went wrong', typeof now.message === 'string' && now.message.length > 0, now.message)

  console.log('\nGoing somewhere else')
  check('another section is reachable', await read(window, nav('Movies')))
  await settle(1200)
  now = await read(window, state())
  check('it draws normally', now.posters > 0 && !now.failed, now)

  console.log('\nAnd back again')
  check('the Guide is still reachable', await read(window, nav('Guide')))
  await settle(1000)
  now = await read(window, state())
  check('it fails the same way rather than blanking', now.failed && now.mounted, now)

  console.log('\nThe player is outside the boundary')
  /*
    Live TV is mounted once and kept across every route so that watching
    survives navigation. If it were inside the boundary, an error on an
    unrelated screen would close the stream.
  */
  check(
    'the player survived the failure',
    await read(window, `!!document.querySelector('.live video, .live .pane--last')`)
  )

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  app.exit(failures === 0 ? 0 : 1)
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
