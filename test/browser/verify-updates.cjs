/**
 * The update prompt and banner, in the interface.
 *
 * `test/sleeptimer.test.ts` covers when a check is due and what is worth
 * showing. This covers the part that actually matters to the promise on the
 * installer: that nothing is asked of anybody until the prompt is answered,
 * that answering it either way is final, and that the banner behaves.
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
const settle = () => new Promise((r) => setTimeout(r, 600))

const state = () => `({
  prompt: Boolean(document.querySelector('.updatebar--ask')),
  banner: Boolean(document.querySelector('.updatebar:not(.updatebar--ask)')),
  bannerText: document.querySelector('.updatebar:not(.updatebar--ask) span')?.textContent ?? '',
  link: document.querySelector('.updatebar:not(.updatebar--ask) a')?.getAttribute('href') ?? '',
  settings: window.__probe.settings()
})`

async function open(window, overrides) {
  await window.loadFile(
    join(__dirname, '..', '..', 'out', 'renderer', 'index.html'),
    { search: `seed=${encodeURIComponent(JSON.stringify(overrides))}` }
  )
  await new Promise((r) => setTimeout(r, 1300))
}

async function main() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    show: true,
    webPreferences: { preload: join(__dirname, 'updates-preload.cjs'), sandbox: false }
  })

  // A fresh install: nobody has been asked yet.
  await open(window, {})
  let now = await read(window, state())
  check('a fresh install asks the question', now.prompt === true, now)
  check('and shows no banner yet', now.banner === false, now)

  // The whole point of the prompt: until it is answered, nothing has been
  // asked of GitHub. The preload records every channel the renderer invoked.
  const asked = await read(window, `window.__probe.invoked()`)
  check('nothing was asked of GitHub before an answer',
    !asked.includes('app:checkUpdate'), asked)

  await read(window, `document.querySelector('.updatebar--ask .btn')?.click()`)
  await settle()
  now = await read(window, state())
  check('answering yes dismisses the question', now.prompt === false, now)
  check('and records the choice', now.settings?.autoCheckUpdates === true, now.settings)

  // Declining must be just as final: an application that keeps asking has not
  // taken no for an answer.
  await open(window, {})
  await read(window, `[...document.querySelectorAll('.updatebar--ask .btn')][1]?.click()`)
  await settle()
  now = await read(window, state())
  check('answering no dismisses it too', now.prompt === false, now)
  check('and records that as a decision, not a blank', now.settings?.autoCheckUpdates === false, now.settings)

  await open(window, { autoCheckUpdates: false })
  now = await read(window, state())
  check('a declined install is never asked again', now.prompt === false, now)

  // A remembered newer version.
  await open(window, {
    autoCheckUpdates: true,
    knownUpdateVersion: '9.9.9',
    knownUpdateUrl: 'https://github.com/olgacveysel/libercast/releases/tag/v9.9.9'
  })
  now = await read(window, state())
  check('a newer version is announced', now.banner === true, now)
  check('the banner names the version', now.bannerText.includes('9.9.9'), now.bannerText)
  check('and links to the release', now.link.startsWith('https://github.com/'), now.link)
  check('the question is not asked alongside it', now.prompt === false, now)

  await read(window, `document.querySelector('.updatebar__close')?.click()`)
  await settle()
  now = await read(window, state())
  check('dismissing it takes it away', now.banner === false, now)
  check('and remembers which version was waved away',
    now.settings?.dismissedUpdate === '9.9.9', now.settings)

  await open(window, {
    autoCheckUpdates: true,
    knownUpdateVersion: '9.9.9',
    knownUpdateUrl: 'https://github.com/olgacveysel/libercast/releases/tag/v9.9.9',
    dismissedUpdate: '9.9.9'
  })
  now = await read(window, state())
  check('a dismissed version stays dismissed across restarts', now.banner === false, now)

  await open(window, {
    autoCheckUpdates: true,
    knownUpdateVersion: '9.9.10',
    knownUpdateUrl: 'https://github.com/olgacveysel/libercast/releases/tag/v9.9.10',
    dismissedUpdate: '9.9.9'
  })
  now = await read(window, state())
  check('but the next version is announced again', now.banner === true, now)

  // Third-party data that reached the database is checked again on the way out.
  await open(window, {
    autoCheckUpdates: true,
    knownUpdateVersion: '9.9.9',
    knownUpdateUrl: 'https://elsewhere.example/not-github'
  })
  now = await read(window, state())
  check('a remembered link off GitHub is never shown', now.banner === false, now)

  window.destroy()
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
