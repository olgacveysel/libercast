/**
 * What the add-source dialog tells people about their password.
 *
 * `test/credentialstorage.test.ts` settles which backend a set of facts means.
 * This settles the part a unit test cannot see: that the sentence on the
 * screen is the one that backend deserves, that an unprotected store is marked
 * as a warning rather than stated in passing, and — the reason this file
 * exists — that no machine is ever shown the DPAPI sentence while the real
 * answer is still in flight.
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

// The password hint is the one that carries the backend attribute; the server
// URL above it is also a .field__hint.
const HINT = `document.querySelector('.field__hint[data-credential-backend]')`

const state = () => `({
  shown: Boolean(${HINT}),
  backend: ${HINT}?.getAttribute('data-credential-backend') ?? null,
  warn: ${HINT}?.classList.contains('field__hint--warn') ?? null,
  text: ${HINT}?.textContent?.trim() ?? '',
  hints: [...document.querySelectorAll('.field__hint')].map((e) => e.textContent.trim())
})`

async function open(window, options, settle = 900) {
  await window.loadFile(
    join(__dirname, '..', '..', 'out', 'renderer', 'index.html'),
    { search: `seed=${encodeURIComponent(JSON.stringify(options))}` }
  )
  await new Promise((r) => setTimeout(r, 1400))
  // The dialog is reached the way a new user reaches it.
  await read(window, `document.querySelector('.btn--big')?.click()`)
  await new Promise((r) => setTimeout(r, settle))
}

async function main() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: { preload: join(__dirname, 'credentials-preload.cjs'), sandbox: false }
  })

  console.log('\nWindows')
  await open(window, { platform: 'win32', storage: { backend: 'dpapi', protectedByOs: true } })
  let now = await read(window, state())
  check('names DPAPI', now.backend === 'dpapi', now)
  check('and is not a warning', now.warn === false, now)
  check('and says so in words', /DPAPI/i.test(now.text), now.text)

  console.log('\nmacOS')
  await open(window, { platform: 'darwin', storage: { backend: 'keychain', protectedByOs: true } })
  now = await read(window, state())
  check('names the Keychain', now.backend === 'keychain', now)
  check('and is not a warning', now.warn === false, now)
  check('and does not mention Windows', !/windows/i.test(now.text), now.text)

  console.log('\nLinux with a keyring')
  await open(window, { platform: 'linux', storage: { backend: 'libsecret', protectedByOs: true } })
  now = await read(window, state())
  check('names the keyring', now.backend === 'libsecret', now)
  check('and is not a warning', now.warn === false, now)
  check('and does not mention Windows', !/windows/i.test(now.text), now.text)

  console.log('\nLinux with no keyring — Chromium\'s built-in key')
  await open(window, { platform: 'linux', storage: { backend: 'plain', protectedByOs: false } })
  now = await read(window, state())
  check('says the store is plain', now.backend === 'plain', now)
  check('and marks it as a warning', now.warn === true, now)
  check('and does not call it encrypted', !/\bencrypt/i.test(now.text), now.text)

  console.log('\nLinux with no encryption at all')
  await open(window, { platform: 'linux', storage: { backend: 'none', protectedByOs: false } })
  now = await read(window, state())
  check('says there is nothing protecting it', now.backend === 'none', now)
  check('and marks it as a warning', now.warn === true, now)
  check('and does not call it encrypted', !/\bencrypt/i.test(now.text), now.text)

  console.log('\nBefore the answer arrives')
  // The regression this guards: falling back to DPAPI while waiting put the
  // one untrue sentence on every Linux screen for the length of a round trip.
  await open(window, {
    platform: 'linux',
    delay: true,
    storage: { backend: 'none', protectedByOs: false }
  })
  now = await read(window, state())
  check('nothing is claimed yet', now.shown === false, now)
  check('and no stale sentence is left on screen', !now.hints.some((h) => /DPAPI/i.test(h)), now.hints)

  await new Promise((r) => setTimeout(r, 4200))
  now = await read(window, state())
  check('the real answer replaces it once it lands', now.backend === 'none', now)
  check('and it is a warning', now.warn === true, now)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  window.destroy()
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main)
