/**
 * The merged list, in the interface.
 *
 * `test/merged.test.ts` proves the SQL groups correctly. This is the other
 * half: that the screen offers the mode at all, that choosing it actually
 * asks for a merged query, that the category rail gets out of the way (the
 * categories belong to one provider and mean nothing across two), and that a
 * channel carried by more than one source says so.
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

const read = (window, script) => window.webContents.executeJavaScript(script)
const settle = () => new Promise((resolve) => setTimeout(resolve, 700))

async function main() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: { preload: join(__dirname, 'merged-preload.cjs'), sandbox: false }
  })

  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'))
  await new Promise((resolve) => setTimeout(resolve, 1400))

  check('the application rendered', (await read(window, `Boolean(document.querySelector('.app'))`)) === true)

  const sources = await read(window, `(() => {
    const items = [...document.querySelectorAll('.sidebar__playlists .navitem')]
    return items.map((i) => i.textContent.trim())
  })()`)
  check('the source list offers All sources first', sources[0]?.includes('All sources'), sources)
  // Four entries, not three: the "Add a source" button lives in this section
  // too, which is a layout detail of the sidebar rather than a source.
  check('alongside both providers',
    sources.some((s) => s.includes('Main')) && sources.some((s) => s.includes('Backup')), sources)

  // Single source first, so the comparison afterwards means something.
  await read(window, `(() => {
    const main = [...document.querySelectorAll('.sidebar__playlists .navitem')]
      .find((i) => i.textContent.includes('Main'))
    main?.click()
  })()`)
  await settle()

  const single = await read(window, `({
    rows: document.querySelectorAll('.chanrow').length,
    badges: document.querySelectorAll('.chanrow__sources').length,
    categories: document.querySelectorAll('.live .pane--cats, .live__cats').length,
    nocats: document.querySelector('.live')?.className.includes('live--nocats')
  })`)
  check('a single source lists its own channels', single.rows === 2, single)
  check('and shows no source badges', single.badges === 0, single)
  check('with its category rail in place', single.nocats === false, single)

  await read(window, `(() => {
    const all = [...document.querySelectorAll('.sidebar__playlists .navitem')]
      .find((i) => i.textContent.includes('All sources'))
    all?.click()
  })()`)
  await settle()

  const merged = await read(window, `({
    rows: [...document.querySelectorAll('.chanrow__name')].map((n) => n.textContent.trim()),
    badges: [...document.querySelectorAll('.chanrow__sources')].map((b) => b.textContent.trim()),
    nocats: document.querySelector('.live')?.className.includes('live--nocats'),
    activeIsAll: document.querySelector('.sidebar__playlists .navitem--active')?.textContent.includes('All sources'),
    badgeTitle: document.querySelector('.chanrow__sources')?.getAttribute('title') ?? ''
  })`)

  check('choosing it marks it as the active source', merged.activeIsAll === true, merged)
  check('channels from every provider are listed', merged.rows.length === 3, merged.rows)
  check('including one only the second provider has',
    merged.rows.some((r) => r.includes('Only On Backup')), merged.rows)
  check('the category rail steps aside', merged.nocats === true, merged)
  check('exactly the shared channel is badged', merged.badges.length === 1, merged.badges)
  check('and the badge names the number of providers', merged.badges[0] === '2', merged.badges)
  check('with an explanation on hover', merged.badgeTitle.includes('2'), merged.badgeTitle)

  // Captured here rather than at the end: the picture is of the merged list,
  // and the last thing this harness does is leave it.
  await new Promise((resolve) => setTimeout(resolve, 400))
  const shot = await window.webContents.capturePage()
  require('node:fs').writeFileSync(
    join(__dirname, '..', '..', 'node_modules', '.cache', 'merged-list.png'),
    shot.toPNG()
  )

  // Going back to one source must undo all of it, or the merged view becomes
  // a mode the user cannot leave.
  await read(window, `(() => {
    const main = [...document.querySelectorAll('.sidebar__playlists .navitem')]
      .find((i) => i.textContent.includes('Backup'))
    main?.click()
  })()`)
  await settle()

  const back = await read(window, `({
    nocats: document.querySelector('.live')?.className.includes('live--nocats'),
    badges: document.querySelectorAll('.chanrow__sources').length,
    activeIsAll: document.querySelector('.sidebar__playlists .navitem--active')?.textContent.includes('All sources')
  })`)
  check('picking a single source leaves merged mode', back.activeIsAll === false, back)
  check('the category rail comes back', back.nocats === false, back)
  check('and the badges go', back.badges === 0, back)

  window.destroy()
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
