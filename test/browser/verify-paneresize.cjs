/**
 * Dragging the separator between the Live TV lists.
 *
 * The lists had fixed widths, and channel names come from the provider: one
 * account's names fit and the next account's are all ellipsis. The answer was
 * a draggable edge, and the thing worth proving is the whole chain — pointer
 * to grid column to stored setting — because each link looks fine on its own
 * while the feature does nothing.
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
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms))

const nav = (label) => `(() => {
  const item = [...document.querySelectorAll('.navitem')]
    .find((b) => b.textContent.trim() === ${JSON.stringify(label)})
  if (!item) return false
  item.click()
  return true
})()`

/** The grid's resolved columns, which is what the user actually sees. */
const columns = () => `(() => {
  const live = document.querySelector('.live')
  if (!live) return null
  const cols = getComputedStyle(live).gridTemplateColumns.split(' ').map(parseFloat)
  return { cols, handles: document.querySelectorAll('.paneresize').length }
})()`

/**
 * A drag, as a sequence of real PointerEvents on the handle.
 *
 * `which: 1` and `button: 0` matter — the component ignores anything that is
 * not the primary button, which is how a right-click does not resize.
 */
const drag = (index, dx) => `(() => {
  const handle = document.querySelectorAll('.paneresize')[${index}]
  if (!handle) return false
  const box = handle.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  const send = (type, clientX) => handle.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
    button: 0, buttons: 1, clientX, clientY: y
  }))
  send('pointerdown', x)
  // In steps, as a hand moves: a single jump would not catch a handler that
  // reads the delta from the previous move rather than from the start.
  for (let i = 1; i <= 4; i++) send('pointermove', x + (${dx} * i) / 4)
  send('pointerup', x + ${dx})
  return true
})()`

const dblclick = (index) => `(() => {
  const handle = document.querySelectorAll('.paneresize')[${index}]
  if (!handle) return false
  handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  return true
})()`

async function main() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: { preload: join(__dirname, 'paneresize-preload.cjs'), sandbox: false }
  })

  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'))
  await settle(1500)

  /*
    Home first. The application opens on Live TV, and choosing the section you
    are already in folds the lists — so navigating straight to it would start
    this test with nothing on screen to drag. (That cost a run.)
  */
  check('Home is reachable', await read(window, nav('Home')))
  await settle(600)
  check('Live TV is reachable', await read(window, nav('Live TV')))
  await settle(1000)

  let now = await read(window, columns())
  check('the screen is laid out as a grid', now !== null && now.cols.length === 3, now)
  check('both lists carry a handle', now && now.handles === 2, now)
  const startCat = now.cols[0]
  const startChan = now.cols[1]
  check('the category list starts at its preset', Math.round(startCat) === 210, startCat)
  check('the channel list starts at its preset', Math.round(startChan) === 320, startChan)

  console.log('\nDragging the category separator right')
  check('the handle takes the drag', await read(window, drag(0, 120)))
  await settle(400)
  now = await read(window, columns())
  check('the category list is wider', Math.round(now.cols[0]) === Math.round(startCat) + 120, now.cols)
  check('the channel list is untouched', Math.round(now.cols[1]) === Math.round(startChan), now.cols)
  check(
    'and the width was stored',
    (await read(window, `window.__probe.lastWidth('liveCategoryWidth')`)) === 330,
    await read(window, `window.__probe.lastWidth('liveCategoryWidth')`)
  )

  console.log('\nDragging the channel separator left')
  check('its handle takes the drag', await read(window, drag(1, -90)))
  await settle(400)
  now = await read(window, columns())
  check('the channel list is narrower', Math.round(now.cols[1]) === Math.round(startChan) - 90, now.cols)
  check(
    'and that width was stored too',
    (await read(window, `window.__probe.lastWidth('liveChannelWidth')`)) === 230,
    await read(window, `window.__probe.lastWidth('liveChannelWidth')`)
  )

  console.log('\nThe picture cannot be squeezed out')
  check('a very long drag is taken', await read(window, drag(0, 4000)))
  await settle(400)
  now = await read(window, columns())
  check('the category list stops at its maximum', Math.round(now.cols[0]) === 440, now.cols)
  check('so the player keeps its room', now.cols[2] >= 320, now.cols)

  console.log('\nDouble-clicking a separator puts it back')
  check('the handle takes the double click', await read(window, dblclick(0)))
  await settle(400)
  now = await read(window, columns())
  check('the category list is at its preset again', Math.round(now.cols[0]) === 210, now.cols)
  check(
    'and the reset was stored',
    (await read(window, `window.__probe.lastWidth('liveCategoryWidth')`)) === 210
  )

  console.log('\nFolding the lists hides the handles')
  // The real gesture: Live TV again, from Live TV.
  check('the fold is reachable', await read(window, nav('Live TV')))
  await settle(500)
  now = await read(window, columns())
  check('the lists are folded away', Math.round(now.cols[0]) === 0, now.cols)
  check(
    'so there is nothing left to drag',
    await read(window, `getComputedStyle(document.querySelector('.paneresize')).display === 'none'`)
  )

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  app.exit(failures === 0 ? 0 : 1)
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
