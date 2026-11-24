/**
 * Finding anything on the Settings screen.
 *
 * It is seventeen sections and a shade over six screens of scrolling — 5,143
 * pixels in a 973-pixel window, measured rather than guessed. Pasting a TMDB
 * key meant scrolling past three screens of other people's concerns; the
 * parental controls were past five. Meanwhile the column is 720 pixels wide,
 * because that is a readable measure for the prose it carries, so on any
 * reasonably wide window there was empty space beside it.
 *
 * The index puts that space to work. This checks it lists what is actually on
 * the screen, and that choosing something goes there.
 *
 * Run against the real main process, because Settings reads most of the
 * application and a hand-written stand-in for it is a source of false
 * findings rather than true ones.
 *
 * Not part of `npm test`: needs a display (`xvfb-run`).
 */
const { app, BrowserWindow } = require('electron')
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

const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms))

const view = () => `(() => {
  const items = [...document.querySelectorAll('.settings__index-item')]
  const groups = [...document.querySelectorAll('.settings .settings__group h3')]
  const pane = document.querySelector('.settings')
  return {
    indexed: items.map((b) => b.textContent.trim()),
    sections: groups.map((h) => h.textContent.trim()),
    active: items.findIndex((b) => b.classList.contains('settings__index-item--active')),
    scrollTop: pane ? Math.round(pane.scrollTop) : -1,
    scrollable: pane ? pane.scrollHeight > pane.clientHeight * 2 : false
  }
})()`

async function main() {
  const backend = require(join(__dirname, '..', '..', 'node_modules', '.cache', 'verify-settings', 'backend.cjs'))
  backend.start(mkdtempSync(join(tmpdir(), 'libercast-settings-')))

  const window = new BrowserWindow({
    width: 1500,
    height: 1000,
    show: true,
    webPreferences: { preload: join(__dirname, '..', '..', 'out', 'preload', 'index.js'), sandbox: false }
  })
  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'))
  await settle(2200)

  const read = (script) => window.webContents.executeJavaScript(script)

  check(
    'Settings is reachable',
    await read(`(() => {
      const item = [...document.querySelectorAll('.navitem')].find((b) => b.textContent.trim() === 'Settings')
      if (!item) return false
      item.click()
      return true
    })()`)
  )
  await settle(1800)

  let now = await read(view())
  check('the screen really is long enough to need an index', now.scrollable, now)
  check('it has many sections', now.sections.length >= 10, now.sections.length)
  check(
    'and the index lists every one of them, in order',
    JSON.stringify(now.indexed) === JSON.stringify(now.sections),
    { indexed: now.indexed, sections: now.sections }
  )
  check('the first is marked as the one being read', now.active === 0, now.active)
  check('and nothing has been scrolled yet', now.scrollTop < 40, now.scrollTop)

  /* The point of the whole thing: reach a section near the bottom. */
  const target = now.sections.length - 2
  console.log(`\nChoosing "${now.sections[target]}"`)
  check(
    'it can be chosen',
    await read(`(() => {
      const items = [...document.querySelectorAll('.settings__index-item')]
      if (!items[${target}]) return false
      items[${target}].click()
      return true
    })()`)
  )
  await settle(1400)

  now = await read(view())
  check('the screen scrolled to it', now.scrollTop > 400, now.scrollTop)
  check(
    'and the index followed, rather than still pointing at the top',
    now.active >= target - 2,
    { active: now.active, target }
  )

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  app.exit(failures === 0 ? 0 : 1)
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
