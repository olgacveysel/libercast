/**
 * The next-episode card, measured against the bar that was covering it.
 *
 * In fullscreen the transport bar leaves the layout and floats over the bottom
 * of the picture, which put it straight on top of a card anchored 20px up.
 * "Looks about right" is how that happened in the first place, so this lays
 * the real markup out with the real stylesheet and compares the two
 * rectangles — at several window sizes, because the bar's height is its
 * content's, not a number anybody chose.
 *
 * Not part of `npm test`: needs a display (`xvfb-run`).
 */
const { app, BrowserWindow } = require('electron')
const { readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const assets = join(__dirname, '..', '..', 'out', 'renderer', 'assets')
const cssFile = readdirSync(assets).find((f) => f.endsWith('.css'))
if (!cssFile) throw new Error('no built stylesheet — run `npm run build` first')
const css = readFileSync(join(assets, cssFile), 'utf8')

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail === undefined ? '' : detail)
  }
}

/**
 * The player's own markup, class for class.
 *
 * An earlier version of this harness invented its own container names and
 * gave them inline positioning, which measured a layout nobody ships: the
 * numbers were right about geometry and silent about the real DOM. Everything
 * here is copied from VodPlayer.tsx, so the containing block the card resolves
 * against is the one the application actually gives it.
 */
function page(modifiers) {
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
${css}
</style>
<div class="vodplayer ${modifiers}">
  <div class="vodplayer__top"><strong>11.22.63</strong></div>

  <div class="vodplayer__stage">
    <video class="vodplayer__video"></video>

    <div class="nextup" id="card">
      <p>NEXT EPISODE</p>
      <strong>S01E04 · 11.22.63 — Teksas'ın Gözleri</strong>
      <div style="display:flex;gap:8px">
        <button class="btn btn--primary">Play now</button>
        <button class="btn btn--ghost">Dismiss</button>
      </div>
    </div>
  </div>

  <div class="transport" id="bar">
    <button class="btn btn--ghost">Prev</button>
    <span class="transport__time">00:12</span>
    <div class="transport__scrub"></div>
    <span class="transport__time">42:10</span>
    <button class="btn btn--ghost">Off</button>
    <button class="btn btn--ghost">Fit</button>
    <button class="btn btn--ghost">Full</button>
  </div>
</div>`
}

const MEASURE = `(() => {
  const card = document.getElementById('card').getBoundingClientRect()
  const bar = document.getElementById('bar').getBoundingClientRect()
  return {
    card: { top: Math.round(card.top), bottom: Math.round(card.bottom), height: Math.round(card.height) },
    bar: { top: Math.round(bar.top), bottom: Math.round(bar.bottom), height: Math.round(bar.height) },
    gap: Math.round(bar.top - card.bottom),
    viewport: window.innerHeight
  }
})()`

async function layout(window, modifiers) {
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(modifiers)))
  return window.webContents.executeJavaScript(MEASURE)
}

async function main() {
  // Three shapes, including one short enough to be a real risk: the bar keeps
  // its height while the picture loses its own.
  for (const [width, height] of [[1280, 800], [1920, 1080], [1024, 560]]) {
    const window = new BrowserWindow({ width, height, show: false })
    const label = `${width}x${height}`

    const windowed = await layout(window, '')
    check(`${label} windowed: the bar sits below the picture`,
      windowed.bar.top >= windowed.card.bottom, windowed)
    // Asked for directly: the card sat close enough to the floor of the
    // picture to read as part of the chrome rather than part of the film.
    check(`${label} windowed: the card is clear of the floor`,
      windowed.gap >= 32, windowed)

    const fs = await layout(window, 'vodplayer--fs')
    // The failure the user actually hit: the bar drawn over the card.
    check(`${label} fullscreen: the card clears the bar`, fs.gap >= 0, fs)
    check(`${label} fullscreen: with room to spare, not a hairline`, fs.gap >= 40, fs)
    check(`${label} fullscreen: and the whole card is on screen`,
      fs.card.top >= 0 && fs.card.bottom <= fs.viewport, fs)

    // Once the bar has faded there is nothing to clear, so the card goes back
    // to the corner it belongs in.
    const idle = await layout(window, 'vodplayer--fs vodplayer--idle')
    check(`${label} idle: the card returns toward the corner`,
      idle.card.bottom > fs.card.bottom, { idle: idle.card, fs: fs.card })
    check(`${label} idle: and is still fully on screen`,
      idle.card.bottom <= idle.viewport, idle)

    window.destroy()
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  app.exit(failures === 0 ? 0 : 1)
}

app.on('window-all-closed', () => undefined)
app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
