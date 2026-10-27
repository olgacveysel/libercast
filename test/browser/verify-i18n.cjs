/**
 * Every language, in front of a real layout engine.
 *
 * The typed dictionary proves that each language has every key, and the
 * untranslated lint proves no English is hiding in the markup. Neither says
 * anything about what the result looks like — and German in particular has a
 * habit of turning a four-letter button into a fourteen-letter one and pushing
 * the control it sits in off the edge of the row.
 *
 * So this renders the real built app with the real stylesheet at each
 * language, then asks the browser two questions it alone can answer: is any
 * text overflowing the box drawn around it, and is any English left on screen.
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

/**
 * Words that would only appear if a string had been missed.
 *
 * Deliberately short and unambiguous: a word like "Status" is the same in
 * German, and a word like "Live" is kept on purpose in both languages.
 */
const ENGLISH_GIVEAWAYS = [
  'Refresh now',
  'Interface size',
  'Hardware acceleration',
  'Preferred audio',
  'Simultaneous downloads',
  'Blocked words',
  'Auto-lock after',
  'Hide adult content',
  'Change or remove the PIN'
]

const MEASURE = `(() => {
  const overflowing = []
  // Controls with a width the content cannot negotiate: a long label here
  // spills out of the control rather than wrapping.
  for (const el of document.querySelectorAll('.segmented button, .badge, .btn, .chip, .langchip')) {
    if (el.scrollWidth > el.clientWidth + 1) {
      overflowing.push({
        text: el.textContent.trim().slice(0, 40),
        scroll: el.scrollWidth,
        client: el.clientWidth,
        cls: el.className
      })
    }
  }

  const root = document.querySelector('.app')
  return {
    overflowing,
    // A row wider than the window means something inside it refused to shrink.
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    text: root ? root.innerText : '',
    rendered: Boolean(root)
  }
})()`

async function main() {
  // Shown, not hidden. A hidden window's compositor does not reliably produce
  // a fresh frame, and `capturePage` then hands back a stale one — which is
  // how a screenshot of this harness came to show the previous language's
  // button still highlighted over correctly translated text.
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: { preload: join(__dirname, 'i18n-preload.cjs'), sandbox: false }
  })

  await window.loadFile(join(__dirname, '..', '..', 'out', 'renderer', 'index.html'))
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const booted = await window.webContents.executeJavaScript(
    `Boolean(document.querySelector('.app'))`
  )
  check('the application rendered', booted === true)
  if (!booted) return finish(window)

  // Driven by clicking, not by reaching into the store: the point is to
  // exercise the same path a user takes, including the re-render the language
  // switch triggers.
  await window.webContents.executeJavaScript(`(() => {
    const nav = [...document.querySelectorAll('.sidebar button, .sidebar a')]
    const settings = nav[nav.length - 1]
    if (settings) settings.click()
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 600))

  const onSettings = await window.webContents.executeJavaScript(
    `document.querySelectorAll('.settings__group').length`
  )
  check('the settings screen opened', onSettings > 0, onSettings)

  for (const language of ['en', 'tr', 'de']) {
    // The language picker is the first segmented control in Appearance, with
    // each option written in its own language — which is exactly how a user
    // who landed in the wrong one finds their way out.
    await window.webContents.executeJavaScript(`(() => {
      const labels = { en: 'English', tr: 'Türkçe', de: 'Deutsch' }
      const want = labels[${JSON.stringify(language)}]
      const button = [...document.querySelectorAll('.segmented button')]
        .find((b) => b.textContent.trim() === want)
      if (button) button.click()
      return Boolean(button)
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 700))

    const result = await window.webContents.executeJavaScript(MEASURE)

    check(`[${language}] the screen still renders`, result.rendered === true)
    check(
      `[${language}] nothing overflows a fixed-width control`,
      result.overflowing.length === 0,
      result.overflowing
    )
    check(
      `[${language}] the page does not scroll sideways`,
      result.pageOverflow <= 0,
      `${result.pageOverflow}px`
    )

    const picker = await window.webContents.executeJavaScript(`(() => {
      const labels = { en: 'English', tr: 'Türkçe', de: 'Deutsch' }
      const want = labels[${JSON.stringify(language)}]
      return [...document.querySelectorAll('.segmented button')]
        .slice(0, 3)
        .map((b) => [b.textContent.trim(), b.getAttribute('aria-pressed')])
        .find(([text]) => text === want)?.[1]
    })()`)
    check(`[${language}] the language picker marks the chosen language`, picker === 'true', picker)
    check(
      `[${language}] the document language follows`,
      (await window.webContents.executeJavaScript('document.documentElement.lang')) === language
    )

    // The DOM is already settled; this extra beat is for the compositor.
    await new Promise((resolve) => setTimeout(resolve, 400))
    const shot = await window.webContents.capturePage()
    require('node:fs').writeFileSync(
      join(__dirname, '..', '..', 'node_modules', '.cache', `settings-${language}.png`),
      shot.toPNG()
    )

    if (language === 'en') {
      check(
        '[en] the English strings are actually on screen',
        ENGLISH_GIVEAWAYS.filter((phrase) => result.text.includes(phrase)).length >= 5,
        ENGLISH_GIVEAWAYS.filter((phrase) => result.text.includes(phrase))
      )
    } else {
      const leftover = ENGLISH_GIVEAWAYS.filter((phrase) => result.text.includes(phrase))
      check(`[${language}] no English is left on the settings screen`, leftover.length === 0, leftover)
    }
  }

  finish(window)
}

function finish(window) {
  try {
    window.destroy()
  } catch {
    /* shutting down */
  }
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
