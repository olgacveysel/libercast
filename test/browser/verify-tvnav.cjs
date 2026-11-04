/**
 * Navigating with a remote.
 *
 * Driven with real key events through `sendInputEvent`, because spatial
 * navigation is Chromium's own handling of the arrow keys — script that moves
 * focus itself would be testing the test.
 *
 * The case worth the most attention is the channel list. It is virtualised:
 * only a window of rows exists in the DOM at a time, and focus cannot move to
 * an element that is not there. That is where a D-pad interface built on a
 * mouse-first application is most likely to dead-end, so it is tested rather
 * than assumed — and if it does dead-end, the result says so.
 *
 * Not part of `npm test`: needs a display (`xvfb-run`) and the switch, which
 * is why this harness passes it itself.
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

// The whole point: Chromium does the geometry. Appended before ready, exactly
// as the application does it from the setting.
app.commandLine.appendSwitch('enable-spatial-navigation')

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail === undefined ? '' : detail)
  }
}

const read = (w, script) => w.webContents.executeJavaScript(script)
const settle = (ms = 260) => new Promise((r) => setTimeout(r, ms))

async function press(window, keyCode, times = 1) {
  for (let i = 0; i < times; i++) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await settle()
  }
}

/** What has focus, described well enough to reason about. */
const focused = () => `(() => {
  const el = document.activeElement
  if (!el || el === document.body) return { tag: 'body', text: null }
  const box = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    cls: typeof el.className === 'string' ? el.className : '',
    text: (el.textContent ?? '').trim().slice(0, 40),
    inView: box.top >= 0 && box.bottom <= window.innerHeight && box.height > 0,
    ring: getComputedStyle(el).outlineWidth
  }
})()`

async function main() {
  const window = new BrowserWindow({
    width: 1280, height: 820, show: true,
    webPreferences: { preload: join(__dirname, 'tvnav-preload.cjs'), sandbox: false }
  })

  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'))
  await settle(1700)

  console.log('\nThe mode is on')
  check('the document is marked for it',
    (await read(window, `document.documentElement.dataset.tv`)) === 'on')

  console.log('\nMoving around the sidebar')
  await read(window, `document.querySelector('.navitem')?.focus()`)
  let now = await read(window, focused())
  check('something is focused to begin with', now.tag === 'button', now)
  const first = now.text

  await press(window, 'Down')
  now = await read(window, focused())
  check('down moves to the next item', now.text !== first, { first, now: now.text })
  check('and the focus ring is actually drawn',
    now.ring !== '0px' && now.ring !== '', now.ring)

  await press(window, 'Up')
  now = await read(window, focused())
  check('up comes back', now.text === first, { first, now: now.text })

  console.log('\nCrossing into the channel list')
  // Clicking "Live TV" while already on Live TV does not navigate — it folds
  // the channel lists away, which is a deliberate feature of the sidebar and
  // was quietly collapsing the very list this harness is here to walk. The
  // application boots straight to Live TV when a source exists, so the click
  // only happens when it is actually needed.
  await read(window, `(() => {
    const item = [...document.querySelectorAll('.navitem')]
      .find((b) => b.textContent.trim() === 'Live TV')
    if (item && !item.className.includes('navitem--active')) item.click()
    return true
  })()`)
  await settle(1400)

  check('the channel lists are open',
    !(await read(window, `document.querySelector('.live').className`)).includes('live--collapsed'),
    await read(window, `document.querySelector('.live').className`))

  await read(window, `document.querySelector('.chanrow')?.focus()`)
  now = await read(window, focused())
  check('a channel row takes focus', now.cls.includes('chanrow'), now)
  const firstRow = now.text

  await press(window, 'Down', 3)
  now = await read(window, focused())
  check('arrows walk down the list', now.text !== firstRow, { firstRow, now: now.text })
  check('and the focused row is on screen', now.inView === true, now)

  console.log('\nInto the part of the list that is not rendered yet')
  // The real question. The list renders a window of rows plus a small
  // overscan; walking past the bottom of that window is where a D-pad
  // interface on a virtualised list dead-ends.
  const before = now.text
  await press(window, 'Down', 25)
  now = await read(window, focused())
  check('focus kept moving past the rendered window',
    now.text !== before && now.cls.includes('chanrow'), { before, now: now.text })
  check('and what has focus is still visible', now.inView === true, now)

  // Reading the row's label is brittle — a row that has just scrolled into
  // place can be measured before its content paints. What actually has to be
  // true is that the list scrolled, because that is the only way focus can
  // reach a row that was not in the DOM when the walk started.
  const scrolled = await read(window, `document.querySelector('.chanlist')?.scrollTop ?? 0`)
  check('the list scrolled to bring unrendered rows within reach',
    scrolled > 0, { scrollTop: scrolled })

  console.log('\nThe player does not trap the arrows')
  await read(window, `document.querySelector('.chanrow')?.click()`)
  await settle(1800)
  await read(window, `document.querySelector('.player button')?.focus()`)
  const inPlayer = await read(window, focused())
  check('a player control can be focused', inPlayer.tag === 'button', inPlayer)

  await press(window, 'Left', 4)
  now = await read(window, focused())
  // With a mouse the arrows seek and change volume. With a remote they must
  // move, or there is no way back to the channel list and no mouse to rescue
  // anyone.
  check('arrows still move focus rather than seeking',
    now.text !== inPlayer.text || now.cls !== inPlayer.cls, { from: inPlayer, to: now })

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  window.destroy()
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main)
