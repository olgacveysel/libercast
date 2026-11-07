/**
 * Sources grouped into folders, in the sidebar.
 *
 * Checked by laying the interface out and reading it back, because every
 * claim here is about what is on screen: which rows are drawn, which are
 * nested, what a shut folder hides, and — the one that matters most — that
 * nothing can make a configured source disappear.
 *
 * The orphan case is the reason this is a browser test rather than a unit
 * one. A source pointing at a folder that is not there is drawn nowhere at
 * all unless the top-level list is defined as "everything not in a folder
 * that exists", and that is a rendering fact, not a data one.
 *
 * Needs a display: run under xvfb.
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
const settle = (ms = 260) => new Promise((r) => setTimeout(r, ms))

/** Every source row on screen, in the order it is drawn. */
const sourceNames = `Array.from(document.querySelectorAll('.navitem--source'))
  .map((el) => el.querySelector('.navitem__label')?.textContent?.trim())
  .filter(Boolean)`

/** Folder headers, with what each one says and whether it is open. */
const folderRows = `Array.from(document.querySelectorAll('.navitem--folder')).map((el) => ({
  name: el.querySelector('.navitem__label')?.textContent?.trim(),
  count: el.querySelector('.navitem__badge')?.textContent?.trim(),
  open: el.getAttribute('aria-expanded') === 'true'
}))`

/** Names of the sources drawn inside a given folder, by folder name. */
const inFolder = (name) => `(() => {
  const header = Array.from(document.querySelectorAll('.navitem--folder'))
    .find((el) => el.querySelector('.navitem__label')?.textContent?.trim() === ${JSON.stringify(name)})
  if (!header) return null
  return Array.from(header.parentElement.querySelectorAll('.navitem--source'))
    .map((el) => el.querySelector('.navitem__label')?.textContent?.trim())
})()`

async function main() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    webPreferences: { preload: join(__dirname, 'folders-preload.cjs'), sandbox: false }
  })

  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'))
  await settle(1700)

  console.log('\nHow the list is arranged')

  const folders = await read(window, folderRows)
  check('every folder is drawn', folders.length === 3, folders)
  check('in the order they are given', folders.map((f) => f.name).join(' < ') ===
    'Living room < Spare box < Nothing here', folders.map((f) => f.name))
  check('a folder says how much is in it', folders.find((f) => f.name === 'Living room')?.count === '2', folders)

  const living = await read(window, inFolder('Living room'))
  check('an open folder shows its sources', living?.join(', ') === 'Alpha provider, Bravo provider', living)

  console.log('\nA folder that is shut')

  const spare = await read(window, inFolder('Spare box'))
  check('its sources are not drawn', spare?.length === 0, spare)
  check('but it still says what it holds', folders.find((f) => f.name === 'Spare box')?.count === '1', folders)
  check('and it is marked shut for a screen reader', folders.find((f) => f.name === 'Spare box')?.open === false)

  const hiddenFromList = await read(window, sourceNames)
  check('the source inside it is nowhere else either', !hiddenFromList.includes('Charlie list'), hiddenFromList)

  console.log('\nOpening it')

  await read(window, `(() => {
    const header = Array.from(document.querySelectorAll('.navitem--folder'))
      .find((el) => el.querySelector('.navitem__label')?.textContent?.trim() === 'Spare box')
    header.click()
  })()`)
  await settle(500)

  const openedSpare = await read(window, inFolder('Spare box'))
  check('its source appears', openedSpare?.includes('Charlie list'), openedSpare)
  const reread = await read(window, folderRows)
  check('and the folder is now marked open', reread.find((f) => f.name === 'Spare box')?.open === true)

  console.log('\nA folder with nothing in it')

  const empty = await read(window, inFolder('Nothing here'))
  check('draws no sources', empty?.length === 0, empty)
  check('but is still drawn itself, rather than looking lost',
    reread.some((f) => f.name === 'Nothing here'))
  check('and says so in words', (await read(window,
    `document.querySelector('.navfolder__empty')?.textContent?.trim().length > 0`)) === true)

  console.log('\nNo source may go missing')

  const everything = await read(window, sourceNames)
  check('the ungrouped source is at the top level', everything.includes('Delta portal'), everything)

  // The one that would be a silent data-loss report. This source points at a
  // folder that does not exist; it belongs to no folder, so it has to fall
  // back to the top level rather than being drawn in neither place.
  check('a source pointing at a folder that is gone is still drawn',
    everything.includes('Echo orphan'), everything)

  check('every configured source is on screen exactly once',
    new Set(everything).size === everything.length && everything.length === 5, everything)

  console.log('\nThe badge names the kind of source')

  const badges = await read(window, `Array.from(document.querySelectorAll('.navitem--source'))
    .map((el) => [
      el.querySelector('.navitem__label')?.textContent?.trim(),
      el.querySelector('.navitem__badge')?.textContent?.trim()
    ])`)
  const badgeFor = (name) => badges.find((b) => b[0] === name)?.[1]
  check('an Xtream source says XC', badgeFor('Alpha provider') === 'XC', badges)
  check('an M3U source says M3U', badgeFor('Charlie list') === 'M3U', badges)
  // It used to say M3U, which is the one thing a portal is definitely not.
  check('a portal does not claim to be M3U', badgeFor('Delta portal') === 'MAC', badges)

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  window.destroy()
  app.exit(failures === 0 ? 0 : 1)
}

app.whenReady().then(main)
