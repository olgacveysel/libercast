/**
 * "Is this your channel?" — in the running interface.
 *
 * `test/failover.test.ts` decides when the main process asks. This checks the
 * half it cannot see: that the question appears instead of a picture, that the
 * names are shown whole rather than trimmed to where they stop differing, that
 * saying yes re-opens with that channel allowed, and that "never offer these"
 * reaches the main process as a refusal rather than quietly closing a dialog.
 *
 * Driven through the real app with the real stylesheet: the preceding version
 * of this project's VOD harness asserted against class names nobody shipped
 * and passed while the feature was broken.
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

const state = () => `({
  prompt: Boolean(document.querySelector('.altprompt')),
  title: document.querySelector('.altprompt__title')?.textContent ?? '',
  reason: document.querySelector('.altprompt__reason')?.textContent ?? '',
  names: [...document.querySelectorAll('.altprompt__name')].map((e) => e.textContent),
  sources: [...document.querySelectorAll('.altprompt__source')].map((e) => e.textContent),
  video: Boolean(document.querySelector('.player__video')?.getAttribute('src')),
  switched: Boolean(document.querySelector('.switched')),
  switchedText: document.querySelector('.switched span')?.textContent ?? '',
  wrong: Boolean(document.querySelector('.switched__wrong')),
  rejected: window.__probe.rejected(),
  opens: window.__probe.opens()
})`

const nav = (label) => `[...document.querySelectorAll('.navitem')]
  .find((b) => b.textContent.trim() === '${label}')?.click()`

/** Opens the channel the stub serves, from wherever the app currently is. */
async function select(window) {
  await read(window, nav('Live TV'))
  await settle(900)
  await read(window, `document.querySelector('.chanrow')?.click()`)
  await settle(1200)
}

/**
 * A fresh start, which also resets the stub: the preload's memory of what has
 * been refused lives in the page, so reloading is the only way back to an
 * install that has never been asked. Anything testing what a refusal changed
 * has to stay in the same page and use `select` instead.
 */
async function restart(window) {
  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'))
  await settle(1500)
  await select(window)
}

/** Leaves the player and comes back, without losing what the stub remembers. */
async function reselect(window) {
  await read(window, nav('Home'))
  await settle(600)
  await select(window)
}

async function main() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: { preload: join(__dirname, 'failover-preload.cjs'), sandbox: false }
  })

  console.log('\nWhen the name is only similar')
  await restart(window)
  let now = await read(window, state())

  check('the question is asked', now.prompt === true, now)
  check('and nothing is playing behind it', now.video === false, now)
  check('it names the channel that failed', now.title.includes('Alto Sports 2 HD'), now.title)
  check('and says why it failed', now.reason.includes('403'), now.reason)

  // The whole question is how the names differ, and the difference is at the
  // end — so a name that is cut off to fit is a question nobody can answer.
  check('both candidates are listed', now.names.length === 2, now.names)
  check('the long name is shown whole',
    now.names[0] === 'Alto Sports 2 Turkey Full HD Backup Feed', now.names)
  check('each says which provider it is on',
    now.sources.join('|').includes('Regional provider'), now.sources)

  const overflow = await read(window, `(() => {
    const e = document.querySelector('.altprompt__name')
    return { clipped: e.scrollWidth > e.clientWidth + 1, truncated: getComputedStyle(e).textOverflow }
  })()`)
  check('and is not clipped by its box', overflow.clipped === false, overflow)
  check('nor ellipsised', overflow.truncated !== 'ellipsis', overflow)

  check('nothing was approved to get here',
    now.opens.every((request) => (request.allow ?? []).length === 0), now.opens)

  console.log('\nSaying yes')
  await read(window, `document.querySelector('.altprompt__offer .btn--primary')?.click()`)
  await settle(900)
  now = await read(window, state())

  check('the question goes away', now.prompt === false, now)
  check('the stream opens', now.video === true, now)
  check('and only then is the channel allowed',
    now.opens.some((request) => (request.allow ?? []).includes(77)), now.opens)
  check('the switch is announced', now.switched === true, now)
  check('naming the provider that took over',
    now.switchedText.includes('Regional provider'), now.switchedText)
  check('and the announcement can be contradicted', now.wrong === true, now)

  console.log('\nSaying it is the wrong channel afterwards')
  await read(window, `document.querySelector('.switched__wrong')?.click()`)
  await settle(1000)
  now = await read(window, state())

  check('the refusal reaches the main process',
    now.rejected.some((r) => r.alternateId === 77 && r.channelId === 1), now.rejected)
  check('and the notice is gone', now.switched === false, now)

  console.log('\nRefusing the whole list')
  await restart(window)
  now = await read(window, state())
  check('the question is asked again on a fresh start', now.prompt === true, now)

  const before = (await read(window, `window.__probe.rejected()`)).length
  await read(window, `[...document.querySelectorAll('.altprompt__actions .btn')][1]?.click()`)
  await settle(900)
  now = await read(window, state())

  check('every offer is refused, not just the first',
    now.rejected.length - before === 2, { before, after: now.rejected.length })
  check('the question closes', now.prompt === false, now)
  check('and nothing started playing', now.video === false, now)

  console.log('\nWhen everything has been refused')
  // Deliberately not a restart: the refusals just made must still stand, which
  // is the whole point of having made them.
  await reselect(window)
  const dismissed = await read(window, state())
  check('a list with nothing left in it is not shown as an empty question',
    dismissed.prompt === false, dismissed)

  // The open is retried twice with a backoff before the error is shown, so
  // this waits for the end of that rather than for a convenient moment.
  await settle(5000)
  const reported = await read(window, `({
    prompt: Boolean(document.querySelector('.altprompt')),
    text: document.querySelector('.main')?.textContent ?? ''
  })`)
  check('the failure is reported instead', reported.text.includes('403'), reported)
  check('and the question stays gone', reported.prompt === false, reported)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  window.destroy()
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main)
