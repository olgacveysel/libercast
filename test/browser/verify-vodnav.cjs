/**
 * Choosing the section you are already in means "back to the list".
 *
 * This exists because the first attempt at it shipped and did nothing. The
 * store was taught to notice a repeated route, and the sidebar never told it:
 * the click handler returned early whenever the route had not changed, so
 * pressing Films while inside a film did not reach the store at all. The
 * reasoning was sound and the wire was not connected, which no unit test on
 * either half would have caught.
 *
 * So the check is made through the running interface, on the thing the user
 * actually does.
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
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms))

const nav = (label) => `(() => {
  const item = [...document.querySelectorAll('.navitem')]
    .find((b) => b.textContent.trim() === ${JSON.stringify(label)})
  if (!item) return false
  item.click()
  return true
})()`

const view = () => `(() => ({
  posters: document.querySelectorAll('.poster').length,
  sheetOpen: !!document.querySelector('.sheet'),
  favoriteTabs: [...document.querySelectorAll('.favorites__tabs .btn')].map((b) => b.textContent.trim())
}))()`

async function main() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: { preload: join(__dirname, 'vodfilters-preload.cjs'), sandbox: false }
  })

  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'), {
    search: `seed=${encodeURIComponent(JSON.stringify({ metadata: true }))}`
  })
  await settle(1500)

  console.log('\nOpening a film')
  check('the Films section is reachable', await read(window, nav('Movies')))
  await settle(1100)

  let now = await read(window, view())
  check('the grid is showing', now.posters > 0, now)
  check('and nothing is open on top of it', !now.sheetOpen, now)

  await read(window, `document.querySelector('.poster').click()`)
  await settle(900)
  now = await read(window, view())
  check('clicking a poster opens the detail', now.sheetOpen, now)

  console.log('\nChoosing Films again')
  check('the navigation item is still there', await read(window, nav('Movies')))
  await settle(900)

  now = await read(window, view())
  // The regression: this did nothing, and the only way back was the sheet's
  // own close button.
  check('the detail closes', !now.sheetOpen, now)
  check('and the grid is back', now.posters > 0, now)

  console.log('\nFavourites is no longer live TV only')
  check('Favourites is reachable', await read(window, nav('Favorites')))
  await settle(900)
  now = await read(window, view())
  check('it offers three tabs', now.favoriteTabs.length === 3, now.favoriteTabs)
  check(
    'one of them is for films',
    now.favoriteTabs.includes('Movies'),
    now.favoriteTabs
  )
  check('and one for series', now.favoriteTabs.includes('Series'), now.favoriteTabs)

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  app.exit(failures === 0 ? 0 : 1)
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
