/**
 * Detached multi-view tiles, driven in real Electron.
 *
 * `test/detached.test.ts` covers the arithmetic — which monitor, where in it,
 * where the sound goes. What it cannot cover is whether a window is actually
 * created, whether asking twice makes two of them (which would cost a second
 * provider connection), whether the window loads the detached player rather
 * than a second copy of the whole application, and whether closing one tells
 * the grid. Those need real windows, so they happen here.
 *
 * Not part of `npm test`: needs a display (`xvfb-run`).
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const cache = join(__dirname, '..', '..', 'node_modules', '.cache', 'verify-detached')
const manager = require(join(cache, 'main', 'detached.cjs'))

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail === undefined ? '' : detail)
  }
}

const sent = () => globalThis.__sent ?? []
const ours = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())

function waitFor(predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting'))
      setTimeout(tick, 50)
    }
    tick()
  })
}

async function main() {
  check('nothing is detached to begin with', manager.detachedTiles().length === 0)

  manager.openDetached(42, 1)
  await waitFor(() => ours().length === 1)

  const [first] = ours()
  check('a window was created', first !== undefined)
  check('the manager knows which tile it is', JSON.stringify(manager.detachedTiles()) === '[1]',
    manager.detachedTiles())
  check('the grid was told', sent().some((m) => m.channel === 'multiview:detachedChanged'),
    sent().map((m) => m.channel))
  check('and told exactly which tiles',
    JSON.stringify(sent().at(-1)?.payload) === '[1]', sent().at(-1))

  // Frameless, because the window carries its own slim bar instead. On a
  // framed window the content is inset below the title bar, so these differ.
  const outer = first.getBounds()
  const content = first.getContentBounds()
  check('the window has no system frame',
    outer.height === content.height && outer.width === content.width, { outer, content })
  check('it can still be moved to the other monitor', first.isMovable())
  check('and resized once it is there', first.isResizable())

  const bounds = first.getBounds()
  const { screen } = require('electron')
  const display = screen.getDisplayMatching(bounds)
  check('it opens inside a real display',
    bounds.x >= display.workArea.x - 1 && bounds.y >= display.workArea.y - 1,
    { bounds, workArea: display.workArea })
  check('it fits in that display',
    bounds.width <= display.workArea.width && bounds.height <= display.workArea.height,
    { bounds, workArea: display.workArea })
  check('it is 16:9', Math.abs(bounds.width / bounds.height - 16 / 9) < 0.02, bounds)

  await waitFor(() => first.webContents.getURL().length > 0)
  const url = first.webContents.getURL()
  check('the window was told which channel to play', url.includes('channel=42'), url)
  check('and which tile it came from', url.includes('tile=1'), url)

  // The single most important check here: a second click must not open a
  // second window, because every window is another provider connection.
  const before = ours().length
  manager.openDetached(42, 1)
  await new Promise((r) => setTimeout(r, 400))
  check('asking twice for the same tile does not open a second window',
    ours().length === before, ours().length)
  check('and the tile list is unchanged', JSON.stringify(manager.detachedTiles()) === '[1]')

  manager.openDetached(99, 3)
  await waitFor(() => ours().length === 2)
  check('a different tile does get its own window', ours().length === 2)
  check('both tiles are reported, in order',
    JSON.stringify(manager.detachedTiles()) === '[1,3]', manager.detachedTiles())

  // What the window actually rendered: the detached player, not a second copy
  // of the whole application with every grid tile re-opened.
  await waitFor(() => !first.webContents.isLoading())
  const dom = await first.webContents.executeJavaScript(`({
    detached: document.querySelectorAll('.detached').length,
    bar: document.querySelectorAll('.detached__bar').length,
    video: document.querySelectorAll('.detached__video').length,
    app: document.querySelectorAll('.app').length,
    sidebar: document.querySelectorAll('.sidebar').length,
    grid: document.querySelectorAll('.mvgrid').length,
    drag: document.querySelector('.detached__bar')
      ? getComputedStyle(document.querySelector('.detached__bar')).webkitAppRegion
      : null
  })`)
  check('the detached player is what rendered', dom.detached === 1, dom)
  check('it has a picture', dom.video === 1, dom)
  check('it has its bar', dom.bar === 1, dom)
  check('the bar is what drags the window to the other monitor', dom.drag === 'drag', dom)
  check('the full application did not mount', dom.app === 0, dom)
  check('no sidebar came with it', dom.sidebar === 0, dom)
  check('and no second multi-view grid', dom.grid === 0, dom)

  // Closing from the window manager, not through the app: the grid has to
  // hear about it either way.
  const sentBefore = sent().length
  ours().find((w) => w.webContents.getURL().includes('tile=1')).close()
  await waitFor(() => manager.detachedTiles().length === 1)
  check('closing a window frees its tile',
    JSON.stringify(manager.detachedTiles()) === '[3]', manager.detachedTiles())
  check('and the grid is told it came back', sent().length > sentBefore)
  check('with the tile gone from the list',
    JSON.stringify(sent().at(-1)?.payload) === '[3]', sent().at(-1))

  manager.closeDetached(3)
  await waitFor(() => manager.detachedTiles().length === 0)
  check('returning a tile from the grid closes its window too', ours().length === 0)

  // A detached window left open would hold a provider connection and, on
  // Windows, keep the application alive with no grid to return to.
  manager.openDetached(7, 0)
  manager.openDetached(8, 2)
  await waitFor(() => ours().length === 2)
  manager.closeAllDetached()
  await waitFor(() => ours().length === 0)
  check('quitting takes every detached window with it', ours().length === 0)
  check('and leaves nothing claimed', manager.detachedTiles().length === 0)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  app.exit(failures === 0 ? 0 : 1)
}

// Electron quits by itself once the last window closes, and this harness
// deliberately closes them all partway through. Without this the run would
// end silently before the checks that come after.
app.on('window-all-closed', () => undefined)

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
