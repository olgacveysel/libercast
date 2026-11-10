/**
 * What Chromium thinks it can do with this machine's GPU.
 *
 * Run from the libercast repo folder:
 *
 *   npx electron gpu-report.cjs
 *
 * It starts a bare Electron with no flags of its own — which is exactly what
 * LiberCast does, since the app sets no GPU switches — so what this reports is
 * what the app gets.
 *
 * Two things come out: a summary printed to the terminal, and the full
 * chrome://gpu page in a window, which carries the blocklist entries and
 * driver details the summary leaves out.
 */
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const status = app.getGPUFeatureStatus()

  console.log('\n--- Chromium GPU feature status ---\n')
  for (const [feature, state] of Object.entries(status)) {
    const mark = /enabled/i.test(state) && !/software/i.test(state) ? ' ' : '!'
    console.log(`${mark} ${feature.padEnd(32)} ${state}`)
  }

  const decode = status.video_decode ?? '(not reported)'
  console.log('\n--- The line that matters ---\n')
  console.log(`video_decode: ${decode}`)
  if (/software|disabled|unavailable/i.test(decode)) {
    console.log(
      '\nThat is the answer: Chromium is not offering hardware video decode at all,\n' +
        'so the player could not have used it. The window now opening says why —\n' +
        'look under "Problems Detected" and at the "Video Decode" row in\n' +
        'Graphics Feature Status.'
    )
  } else {
    console.log(
      '\nChromium says hardware decode IS available, which means it was offered and\n' +
        'not taken for this particular stream. That points at the codec profile or\n' +
        'the adapter chosen rather than at the machine.'
    )
  }

  const window = new BrowserWindow({ width: 1200, height: 900, title: 'chrome://gpu' })
  window.loadURL('chrome://gpu')
  window.on('closed', () => app.quit())
})
