/**
 * Tests run under Electron's node (ELECTRON_RUN_AS_NODE=1) so the native
 * better-sqlite3 build matches. `electron` still resolves to the real module
 * there but has no app instance, so the few APIs the code touches are stubbed.
 */
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libercast-test-'))

module.exports = {
  app: { getPath: () => dir, getVersion: () => '0.0.0-test', getName: () => 'LiberCast' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: () => {} },
  dialog: {},
  BrowserWindow: class {},
  shell: {},
  session: {}
}
