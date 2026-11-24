#!/usr/bin/env node
/**
 * Bundles the walkthrough and runs it under Electron, the way `test/run.mjs`
 * does for the suite — so it can import the application's own modules and
 * drive the real main process.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require_ = createRequire(import.meta.url)
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const outDir = join(root, 'node_modules/.cache/libercast-walkthrough')
mkdirSync(outDir, { recursive: true })

const bundle = join(outDir, 'walk.cjs')
await build({
  entryPoints: [join(root, 'tools/walkthrough/walk.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  alias: { '@main': join(root, 'src/main'), '@shared': join(root, 'src/shared') },
  external: ['electron', 'better-sqlite3', 'ffmpeg-static', 'ffprobe-static'],
  logLevel: 'error'
})

const result = spawnSync(require_('electron'), ['--no-sandbox', '--disable-gpu', bundle], {
  stdio: 'inherit',
  cwd: root
})
process.exit(result.status ?? 1)
