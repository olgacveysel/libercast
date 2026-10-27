/**
 * The multi-view grid, measured in the browser that actually ships.
 *
 * `test/multiviewlayout.test.ts` checks the strings `gridStyle` returns. What
 * it cannot check is whether CSS grid, given those strings plus the
 * `grid-column: 1 / -1; grid-row: 1` rule on the promoted tile, actually puts
 * one big picture on top and the rest in a strip underneath — that is a
 * layout-engine question, and the first version of this got it wrong (spans
 * inside the original tracks overflowed). So this lays the real markup out in
 * real Chromium with the real stylesheet and measures the rectangles.
 *
 * Not part of `npm test`: needs a display (`xvfb-run`).
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..', '..')
const assets = join(root, 'out', 'renderer', 'assets')
const cssFile = readdirSync(assets).find((f) => f.endsWith('.css'))
if (!cssFile) throw new Error('no built stylesheet in out/renderer/assets — run `npm run build` first')
const css = readFileSync(join(assets, cssFile), 'utf8')

const { gridStyle } = require(join(root, 'node_modules', '.cache', 'verify-multiview', 'layout.cjs'))

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail === undefined ? '' : detail)
  }
}

/** Build a page with `count` tiles, `focused` promoted (or null for even). */
function page(columns, rows, focused) {
  const count = columns * rows
  const style = gridStyle(columns, rows, focused)
  const inline = `grid-template-columns:${style.gridTemplateColumns};grid-template-rows:${style.gridTemplateRows}`
  const tiles = Array.from({ length: count }, (_, i) =>
    // Promoting also moves the sound, so the promoted tile carries
    // `mvtile--audio` here exactly as `promote()` makes it carry it.
    `<div class="mvtile ${i === focused ? 'mvtile--focused mvtile--audio' : ''}" data-i="${i}"><div class="mvtile__bar">${i + 1}</div></div>`
  ).join('')
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
body{display:flex;flex-direction:column;height:100vh}
${css}
</style>
<div id="grid" class="mvgrid ${focused !== null ? 'mvgrid--focus' : ''}" style="${inline}">${tiles}</div>`
}

const measure = `(() => {
  const grid = document.getElementById('grid')
  return {
    tiles: [...grid.children].map((el) => {
      const r = el.getBoundingClientRect()
      return { i: Number(el.dataset.i), x: Math.round(r.x), y: Math.round(r.y),
               w: Math.round(r.width), h: Math.round(r.height),
               focused: el.classList.contains('mvtile--focused'),
               barOpacity: getComputedStyle(el.querySelector('.mvtile__bar')).opacity }
    }),
    cols: getComputedStyle(grid).gridTemplateColumns,
    rows: getComputedStyle(grid).gridTemplateRows
  }
})()`

async function layoutOf(win, columns, rows, focused) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(columns, rows, focused)))
  return win.webContents.executeJavaScript(measure)
}

async function main() {
  const win = new BrowserWindow({ width: 1280, height: 800, show: false })

  for (const [columns, rows] of [[2, 1], [2, 2], [3, 2], [3, 3]]) {
    const count = columns * rows
    const label = `${columns}x${rows}`

    const even = await layoutOf(win, columns, rows, null)
    const evenRowTops = new Set(even.tiles.map((t) => t.y))
    check(`${label}: even grid uses ${rows} row(s)`, evenRowTops.size === rows,
      [...evenRowTops].join(','))
    check(`${label}: even tiles are all the same size`,
      new Set(even.tiles.map((t) => `${t.w}x${t.h}`)).size === 1,
      even.tiles.map((t) => `${t.w}x${t.h}`).join(' '))

    // Promote a tile that is NOT the first one: grid places explicitly
    // positioned items before it auto-fills, so the promoted tile must reach
    // the top row however far down the list it started.
    const target = count - 1
    const spot = await layoutOf(win, columns, rows, target)
    const hero = spot.tiles.find((t) => t.i === target)
    const strip = spot.tiles.filter((t) => t.i !== target)

    check(`${label}: promoted tile is on the top row`, hero.y === Math.min(...spot.tiles.map((t) => t.y)),
      `hero.y=${hero.y}`)
    check(`${label}: promoted tile spans the full width`,
      hero.w >= Math.max(...strip.map((t) => t.x + t.w)) - hero.x - 1,
      `hero.w=${hero.w} strip right edge=${Math.max(...strip.map((t) => t.x + t.w))}`)
    check(`${label}: promoted tile is bigger than it was`, hero.w * hero.h > even.tiles[0].w * even.tiles[0].h,
      `${hero.w}x${hero.h} vs ${even.tiles[0].w}x${even.tiles[0].h}`)
    check(`${label}: every other tile fits in one strip below it`,
      strip.length === 0 || (new Set(strip.map((t) => t.y)).size === 1 && Math.min(...strip.map((t) => t.y)) >= hero.y + hero.h - 1),
      `strip tops=${[...new Set(strip.map((t) => t.y))].join(',')} hero bottom=${hero.y + hero.h}`)
    check(`${label}: nothing overflows the grid`,
      spot.tiles.every((t) => t.x >= 0 && t.y >= 0 && t.x + t.w <= 1281 && t.y + t.h <= 801),
      spot.tiles.map((t) => `${t.x},${t.y} ${t.w}x${t.h}`).join(' | '))
    if (strip.length > 0) {
      check(`${label}: strip tile bars are hidden until hover`,
        strip.every((t) => t.barOpacity === '0'),
        strip.map((t) => t.barOpacity).join(','))
      check(`${label}: the promoted tile keeps its bar`, hero.barOpacity === '1', hero.barOpacity)
    }
  }

  // Fullscreen, on the element the app actually fullscreens.
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(2, 2, null)))
  const fs = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const grid = document.getElementById('grid')
      document.addEventListener('fullscreenchange', () => {
        resolve({ element: document.fullscreenElement === grid,
                  padding: getComputedStyle(grid).padding })
      }, { once: true })
      grid.requestFullscreen()
    })`, true)
  check('fullscreen targets the grid itself', fs.element === true, fs)
  check('fullscreen drops the grid padding', fs.padding === '0px', fs.padding)

  const exited = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      document.addEventListener('fullscreenchange', () => resolve(document.fullscreenElement === null), { once: true })
      document.exitFullscreen()
    })`, true)
  check('fullscreen exits again', exited === true)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  app.exit(failures === 0 ? 0 : 1)
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
