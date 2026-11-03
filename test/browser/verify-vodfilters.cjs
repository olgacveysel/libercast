/**
 * The film browser's sort and filter controls, in the running interface.
 *
 * The subtle half of this feature is not the filtering, which a unit test
 * covers, but knowing when not to offer it. An M3U playlist carries no
 * ratings and no years, and plenty of Xtream panels send neither; a rating
 * filter there is a control whose only possible effect is to empty the
 * screen. So the controls appear only once the catalogue has shown it has the
 * data — and, once shown, stay, because a filtered page legitimately coming
 * back empty must not make the control the user just used disappear.
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

const SELECTS = `[...document.querySelectorAll('.toolbar select')]`

const state = () => `(() => {
  const selects = ${SELECTS}
  return {
    count: selects.length,
    labels: selects.map((s) => s.getAttribute('aria-label')),
    sortOptions: selects[0] ? [...selects[0].options].map((o) => o.value) : [],
    titles: [...document.querySelectorAll('.vodcard__name, .poster__name, .vodcard strong')]
      .map((e) => e.textContent.trim()),
    lastQuery: window.__probe.lastQuery()
  }
})()`

async function open(window, options) {
  await window.loadFile(
    join(__dirname, '..', '..', 'out', 'renderer', 'index.html'),
    { search: `seed=${encodeURIComponent(JSON.stringify(options))}` }
  )
  await settle(1500)
  await read(window, `[...document.querySelectorAll('.navitem')]
    .find((b) => b.textContent.trim() === 'Movies')?.click()`)
  await settle(1100)
}

/** Picks a value in the select carrying this aria-label. */
const choose = (label, value) => `(() => {
  const select = ${SELECTS}.find((s) => s.getAttribute('aria-label') === ${JSON.stringify(label)})
  if (!select) return false
  select.value = ${JSON.stringify(value)}
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`

async function main() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: { preload: join(__dirname, 'vodfilters-preload.cjs'), sandbox: false }
  })

  console.log('\nA source that carries ratings and years')
  await open(window, { metadata: true })
  let now = await read(window, state())

  check('all three controls are offered', now.count === 3, now.labels)
  check('sorting is one of them', now.labels.includes('Sort by'), now.labels)
  check('so is a rating filter', now.labels.includes('Minimum rating'), now.labels)
  check('and a decade filter', now.labels.includes('Decade'), now.labels)
  check('every sort is available',
    ['name', 'added', 'rating', 'year'].every((o) => now.sortOptions.includes(o)),
    now.sortOptions)

  console.log('\nChoosing a sort')
  await read(window, choose('Sort by', 'rating'))
  await settle(900)
  now = await read(window, state())
  check('the query asks for it', now.lastQuery?.sort === 'rating', now.lastQuery)
  check('and carries no filter it was not given',
    now.lastQuery?.minRating === undefined, now.lastQuery)

  console.log('\nFiltering by rating')
  await read(window, choose('Minimum rating', '7'))
  await settle(900)
  now = await read(window, state())
  check('the floor reaches the query', now.lastQuery?.minRating === 7, now.lastQuery)
  check('the sort is not lost when a filter changes',
    now.lastQuery?.sort === 'rating', now.lastQuery)

  console.log('\nFiltering by decade')
  await read(window, choose('Decade', '2020'))
  await settle(900)
  now = await read(window, state())
  check('both ends of the decade are sent',
    now.lastQuery?.yearFrom === 2020 && now.lastQuery?.yearTo === 2029, now.lastQuery)

  console.log('\nWhen a filter matches nothing')
  // The regression this guards: deciding the source has no ratings because
  // this page of results happens to contain none, and removing the control
  // the user just used.
  await read(window, choose('Minimum rating', '8'))
  await settle(300)
  await read(window, choose('Decade', '1950'))
  await settle(1000)
  now = await read(window, state())
  check('the page really is empty', now.titles.length === 0, now.titles)
  check('and the controls are still there', now.count === 3, now.labels)

  console.log('\nA source that carries neither')
  await open(window, { metadata: false })
  now = await read(window, state())

  check('only sorting is offered', now.count === 1, now.labels)
  check('and it offers only the sorts that mean something',
    now.sortOptions.join(',') === 'name,added', now.sortOptions)
  check('no rating filter is shown', !now.labels.includes('Minimum rating'), now.labels)
  check('no decade filter either', !now.labels.includes('Decade'), now.labels)
  check('and nothing was filtered behind the scenes',
    now.lastQuery?.minRating === undefined && now.lastQuery?.yearFrom === undefined,
    now.lastQuery)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  window.destroy()
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main)
