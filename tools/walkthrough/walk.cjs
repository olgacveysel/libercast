/**
 * Walks the whole application and photographs it.
 *
 * Not a test: nothing here asserts. It opens every screen with plausible data
 * behind it and writes a PNG of each, so that the interface can be reviewed
 * as a person meets it rather than as a tree of components.
 *
 *   xvfb-run -a npx electron --no-sandbox --disable-gpu tools/walkthrough/walk.cjs
 *
 * Nine of the ten screens photograph faithfully. **Settings does not yet**:
 * it reads more of the application's state than anything else, and the
 * stand-in bridge below has to match every shape exactly or the screen fails
 * — which it currently does, on a date field. The failure is the fixture's,
 * not the application's, and the screenshot shows the error boundary doing
 * its job rather than a blank window, which is worth something on its own.
 * Settings is better photographed against a real seeded database than a
 * hand-written bridge, and that is the next piece of work here.
 */
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')

const OUT = join(__dirname, 'shots')
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms))

async function shoot(window, name) {
  const image = await window.capturePage()
  writeFileSync(join(OUT, `${name}.png`), image.toPNG())
  console.log(`  ${name}.png`)
}

const click = (label) => `(() => {
  const item = [...document.querySelectorAll('.navitem')]
    .find((b) => b.textContent.trim() === ${JSON.stringify(label)})
  if (!item) return false
  item.click()
  return true
})()`

const clickAny = (selector, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((b) => b.textContent.trim().includes(${JSON.stringify(text)}))
  if (!el) return false
  el.click()
  return true
})()`

async function main() {
  mkdirSync(OUT, { recursive: true })
  const window = new BrowserWindow({
    width: 1600, height: 1000, show: true,
    webPreferences: { preload: join(__dirname, 'bridge.cjs'), sandbox: false }
  })
  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'))
  await settle(2000)

  const read = (script) => window.webContents.executeJavaScript(script)

  for (const [label, file] of [
    ['Home', '01-home'],
    ['Live TV', '02-live'],
    ['Guide', '03-guide'],
    ['Movies', '04-movies'],
    ['Series', '05-series'],
    ['Favorites', '06-favorites'],
    ['Multi-view', '07-multiview'],
    ['Library', '08-library'],
    ['Settings', '09-settings']
  ]) {
    const ok = await read(click(label))
    await settle(1200)
    if (!ok) console.log(`  (no navigation item called ${label})`)
    await shoot(window, file)
  }

  // A film's detail sheet, which is where most of the metadata work shows.
  await read(click('Movies'))
  await settle(900)
  await read(`document.querySelector('.poster')?.click()`)
  await settle(1100)
  await shoot(window, '10-film-detail')

  // The settings sections, which are the densest screens in the application.
  await read(click('Settings'))
  await settle(900)
  const sections = await read(`JSON.stringify(
    [...document.querySelectorAll('.settings__nav button, .settings nav button, [role="tab"]')]
      .map((b) => b.textContent.trim()).filter(Boolean)
  )`)
  console.log(`  settings sections: ${sections}`)
  let n = 11
  for (const heading of JSON.parse(sections)) {
    const ok = await read(clickAny('.settings__nav button, .settings nav button, [role="tab"]', heading))
    await settle(700)
    if (ok) await shoot(window, `${n++}-settings-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
  }

  const missing = await read('window.__walk.missing()')
  console.log('\nIPC channels the screens asked for and nothing answered:')
  console.log(missing.length ? missing.map((m) => `  ${m}`).join('\n') : '  (none)')

  app.exit(0)
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
