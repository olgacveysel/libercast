#!/usr/bin/env node
/**
 * Bundles each test/*.test.ts and runs it under Electron's node runtime, so the
 * native better-sqlite3 binary (built for Electron's ABI by electron-builder)
 * loads without a second rebuild.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require_ = createRequire(import.meta.url)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
// Bundles live inside the project so `require('better-sqlite3')` still resolves.
const outDir = join(root, 'node_modules/.cache/libercast-tests')
mkdirSync(outDir, { recursive: true })

const electron = require_('electron')
const files = readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.ts'))

let failed = 0

for (const file of files) {
  const bundle = join(outDir, file.replace(/\.ts$/, '.cjs'))

  try {
    await build({
      entryPoints: [join(root, 'test', file)],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: bundle,
      alias: {
        '@main': join(root, 'src/main'),
        '@shared': join(root, 'src/shared'),
        // Renderer modules are testable when they are kept free of React and
        // the DOM — the subtitle track rules are, deliberately.
        '@renderer': join(root, 'src/renderer/src'),
        electron: join(root, 'test/electron-stub.cjs')
      },
      // Native and binary-shipping packages resolve their own paths from
      // __dirname, which bundling would relocate.
      external: ['better-sqlite3', 'ffmpeg-static', 'ffprobe-static'],
      logLevel: 'error'
    })
  } catch {
    failed++
    continue
  }

  console.log(`\n=== ${file} ===`)
  const run = spawnSync(electron, [bundle], {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })

  if (run.status !== 0) {
    console.error(`  -> ${file} exited with status ${run.status}${run.signal ? ` (signal ${run.signal})` : ''}`)
    failed++
  }
}

if (failed > 0) {
  console.error(`\n${failed} test file(s) failed.`)
  process.exit(1)
}
console.log('\nAll test files passed.')
