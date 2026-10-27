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
