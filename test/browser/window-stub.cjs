/**
 * Stands in for the main window while the detached-window manager is driven
 * under test. Everything it is asked to send is recorded, so the harness can
 * assert on what the grid would have been told.
 */
globalThis.__sent = []

const fake = {
  webContents: {
    send(channel, payload) {
      globalThis.__sent.push({ channel, payload })
    }
  },
  getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 })
}

exports.getMainWindow = () => fake
exports.createWindow = () => fake

/**
 * The real one attaches the shell rules every window must have. The harness
 * runs a real BrowserWindow, so this records the call and leaves the window
 * alone — what matters here is that `openDetached` asks for it at all, which
 * `test/shellguards.test.ts` checks against the source, and that the manager
 * still works with it in place.
 */
globalThis.__guarded = []
exports.guardWindow = (window) => {
  globalThis.__guarded.push(window)
}

exports.isWebLink = (value) => /^https?:\/\//i.test(value)
