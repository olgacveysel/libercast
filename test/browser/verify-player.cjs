/**
 * The player, verified in the browser that actually ships.
 *
 * Everything else in test/ runs under Node, where `fetch` does not enforce CORS
 * and there is no media element — so a suite that was entirely green coexisted
 * for a long time with subtitles that never once appeared on screen. This runs
 * the real Electron, loads the real stream server, and asks the video element
 * what it ended up with.
 *
 * Not part of `npm test`: it needs a display (on Linux, `xvfb-run`). Run it
 * with `npm run verify:player` after touching anything in the playback path.
 */
// The diagnostic run inside real Electron: same Chromium the app ships, with
// the codecs the app relies on, against the real stream server.
const { app, BrowserWindow } = require('electron')
const { createServer } = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

// Bundled by the npm script before this runs, because the main process is
// TypeScript and Electron will not load it directly.
const { StreamServer } = require(join(__dirname, '..', '..', 'node_modules', '.cache', 'verify-player', 'streamServer.cjs'))
// The same builder the renderer uses, so what is verified here is the string
// the app actually installs — not a hand-written copy of it.
const { subtitleCss, normalizeSubtitleStyle } = require(join(__dirname, '..', '..', 'node_modules', '.cache', 'verify-player', 'subtitleStyle.cjs'))

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail === undefined ? '' : detail)
  }
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'ediag-'))
  const srt = join(work, 's.srt')
  execFileSync('sh', ['-c',
    `printf '1\\n00:00:06,000 --> 00:00:12,000\\nFIRST LINE\\n\\n2\\n00:00:14,000 --> 00:00:19,000\\nSECOND LINE\\n\\n' > ${srt}`])

  const fixture = join(work, 'clip.mkv')
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error',
    '-f','lavfi','-i','testsrc=d=25:s=320x240','-f','lavfi','-i','sine=d=25','-i',srt,
    '-map','0:v','-map','1:a','-map','2:s',
    '-c:v','libx264','-preset','ultrafast','-g','75','-c:a','aac','-c:s','srt','-y',fixture])

  const server = new StreamServer()
  await server.start()

  // Resume four seconds in: the case the user hits on every movie and episode.
  const session = await server.open({ url: fixture, label: 'clip', subtitleTrack: 0, seekSecs: 4 })
  console.log('absoluteTimeline:', session.absoluteTimeline)

  const page = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!doctype html><meta charset="utf-8">
<video id="v" autoplay muted playsinline></video>
<script>
window.diag = { log: [] }
const v = document.getElementById('v')
v.src = ${JSON.stringify(session.url)}
const track = v.addTextTrack('subtitles', 'Subtitles')
track.mode = 'showing'
window.__track = track
v.addEventListener('loadedmetadata', () => window.diag.log.push('loadedmetadata at currentTime ' + v.currentTime.toFixed(2)))
v.addEventListener('error', () => window.diag.log.push('video error ' + (v.error && v.error.code)))

fetch(${JSON.stringify(session.subtitlesUrl)}).then(async (res) => {
  window.diag.log.push('subtitle response ' + res.status)
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    buf += dec.decode(value, { stream: true })
    const blocks = buf.split(/\\n\\n+/); buf = blocks.pop() || ''
    for (const b of blocks) {
      const m = /((?:\\d+:)?\\d\\d:\\d\\d[.,]\\d+)\\s*-->\\s*((?:\\d+:)?\\d\\d:\\d\\d[.,]\\d+)/.exec(b)
      if (!m) continue
      const secs = (t) => { const p = t.replace(',','.').split(':').map(Number); return p.length===3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1] }
      const text = b.split('\\n').filter((l) => l.trim() && l.indexOf('-->') === -1).join('\\n')
      try { track.addCue(new VTTCue(secs(m[1]), secs(m[2]), text)) }
      catch (e) { window.diag.log.push('addCue threw: ' + e.message) }
    }
  }
  // The app's parser flushes the trailing block; this one has to as well, or
  // the last cue is left sitting in the buffer forever.
  const tail = buf.trim()
  if (tail) {
    const m = /((?:\\d+:)?\\d\\d:\\d\\d[.,]\\d+)\\s*-->\\s*((?:\\d+:)?\\d\\d:\\d\\d[.,]\\d+)/.exec(tail)
    if (m) {
      const secs = (t) => { const p = t.replace(',','.').split(':').map(Number); return p.length===3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1] }
      const text = tail.split('\\n').filter((l) => l.trim() && l.indexOf('-->') === -1).join('\\n')
      try { track.addCue(new VTTCue(secs(m[1]), secs(m[2]), text)) } catch (e) { window.diag.log.push('tail addCue threw: ' + e.message) }
    }
  }
  window.diag.log.push('cue stream ended')
}).catch((e) => window.diag.log.push('subtitle fetch FAILED: ' + e.message))
</script>`)
  })
  await new Promise((r) => page.listen(0, '127.0.0.1', r))

  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { backgroundThrottling: false } })
  win.webContents.on('console-message', (_e, _l, message) => console.log('  [renderer]', message))
  await win.loadURL(`http://127.0.0.1:${page.address().port}/`)

  const { readFileSync, readdirSync } = require('node:fs')
  let snapshotLog = ''
  let lastCues = -1
  let seenFirst = false
  let seenSecond = false
  let played = false

  for (let i = 0; i < 9; i++) {
    await new Promise((r) => setTimeout(r, 2500))
    const snap = await win.webContents.executeJavaScript(`(() => {
      const v = document.getElementById('v'); const t = window.__track
      return {
        currentTime: Number(v.currentTime.toFixed(2)),
        readyState: v.readyState,
        cues: t.cues ? t.cues.length : -1,
        cueTimes: Array.from(t.cues || []).map(c => c.startTime.toFixed(1)),
        activeCues: Array.from(t.activeCues || []).map(c => c.text),
        log: window.diag.log
      }
    })()`)
    if (snap.readyState >= 3 && snap.currentTime > 0) played = true
    if (snap.activeCues.includes('FIRST LINE')) seenFirst = true
    if (snap.activeCues.includes('SECOND LINE')) seenSecond = true
    console.log('  ' + JSON.stringify(snap))
    snapshotLog = snap.log.join(' | ')
    lastCues = snap.cues
  }

  check('the video played', played)
  check('the subtitle request was not blocked', snapshotLog.includes('subtitle response 200'), snapshotLog)
  check('both cues reached the track', lastCues === 2, lastCues)
  // The point of the whole exercise: not that cues exist, but that the element
  // displays each one during its own window.
  check('the first cue was shown while it was due', seenFirst)
  check('the second cue was shown while it was due', seenSecond)

  await verifyCueAppearance(server, work, page)

  console.log(failures === 0 ? '\nverify:player: all passed' : `\nverify:player: ${failures} failed`)

  // This session's own file, read before the server cleans it up.
  const own = join(tmpdir(), 'libercast-' + session.id + '.vtt')
  try {
    console.log('--- ffmpeg wrote (this session) ---')
    console.log(readFileSync(own, 'utf8').trim())
  } catch (e) {
    console.log('--- no subtitle file for this session: ' + e.code + ' ---')
  }

  server.closeAll()
  page.close()
  app.exit(failures === 0 ? 0 : 1)
}

/**
 * The subtitle appearance settings, verified by looking at the pixels.
 *
 * Cues are drawn by the browser inside the video element: nothing in the DOM
 * reports their colour, `getComputedStyle` does not answer for `::cue`, and the
 * rule is silently ignored if a property is not one `::cue` honours. So the only
 * honest check is to draw a cue over a flat black picture in a colour that
 * cannot occur in the source, capture the window, and count the pixels.
 *
 * Two captures rather than one: the second is at a larger size, which shows the
 * size setting is honoured too and rules out a fluke count.
 */
async function verifyCueAppearance(server, work, existingPage) {
  const flat = join(work, 'flat.mkv')
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error',
    '-f','lavfi','-i','color=c=black:s=640x360:d=20','-f','lavfi','-i','sine=d=20',
    '-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-c:a','aac','-y',flat])

  const session = await server.open({ url: flat, label: 'flat', seekSecs: 0 })

  // Magenta: not a colour a black source can produce, so every pixel of it in
  // the capture came from the cue.
  const style = (scale) => subtitleCss(normalizeSubtitleStyle({
    subtitleScale: scale,
    subtitleColor: '#ff00ff',
    subtitleBackgroundOpacity: 0,
    subtitleEdge: 'none',
    subtitleFont: 'sans'
  }))

  const page = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#000}video{display:block;width:800px;height:450px}</style>
<style id="subtitle-appearance">${style(0.9)}</style>
<video id="v" autoplay muted playsinline src=${JSON.stringify(session.url)}></video>
<script>
const v = document.getElementById('v')
const track = v.addTextTrack('subtitles', 'Subtitles')
track.mode = 'showing'
// One long cue, so the capture cannot land between cues.
track.addCue(new VTTCue(0, 600, 'MMMM MMMM MMMM'))
window.__setScale = (css) => { document.getElementById('subtitle-appearance').textContent = css }
window.__active = () => (track.activeCues || []).length
</script>`)
  })
  await new Promise((r) => page.listen(0, '127.0.0.1', r))

  const win = new BrowserWindow({ show: true, width: 800, height: 600, webPreferences: { backgroundThrottling: false } })
  await win.loadURL(`http://127.0.0.1:${page.address().port}/`)

  // Count the cue-coloured pixels once the element is actually showing a cue.
  const magenta = async () => {
    const image = await win.webContents.capturePage()
    const { width, height } = image.getSize()
    const bitmap = image.getBitmap() // BGRA
    let found = 0
    for (let i = 0; i < bitmap.length; i += 4) {
      // Anti-aliasing softens the edges, so this is a band rather than an
      // exact match — but green stays low, which black and white cannot fake.
      if (bitmap[i] > 150 && bitmap[i + 2] > 150 && bitmap[i + 1] < 90) found++
    }
    return { found, pixels: width * height }
  }

  let small = { found: 0 }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1200))
    const active = await win.webContents.executeJavaScript('window.__active()')
    if (!active) continue
    small = await magenta()
    if (small.found > 0) break
  }
  console.log('  cue pixels at 0.9x:', JSON.stringify(small))

  check('the chosen cue colour reaches the screen', small.found > 40, small)

  await win.webContents.executeJavaScript(`window.__setScale(${JSON.stringify(style(2.4))})`)
  await new Promise((r) => setTimeout(r, 1500))
  const large = await magenta()
  console.log('  cue pixels at 2.4x:', JSON.stringify(large))

  // Area grows with the square of the size, so a real change is unmistakable;
  // 1.8 leaves room for hinting and for the line wrapping differently.
  check('a larger size draws more of it', large.found > small.found * 1.8, { small, large })

  win.destroy()
  page.close()
  void existingPage
}

app.disableHardwareAcceleration()
app.whenReady().then(main).catch((e) => { console.error('THREW', e); app.quit() })
