import { readFileSync, readdirSync } from 'node:fs'

/**
 * The contract and the preload allowlist have to agree, and the compiler
 * cannot make them.
 *
 * `IpcContract` is a type, so it is gone by the time anything runs.
 * `IPC_CHANNELS` is the array the preload bridge checks a call against before
 * forwarding it. Declaring a channel in the contract and forgetting the array
 * compiles perfectly and then fails in front of the user, at the moment they
 * click the thing, with a message about a channel not being allowed — and
 * only on the code path nobody exercised. So the two lists are compared as
 * text, which is the only place both of them still exist together.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

// Relative to the repository root, as the other source-reading tests are:
// the suite bundles each file elsewhere, so __dirname is not the test folder.
const source = readFileSync('src/shared/ipc.ts', 'utf8')

function block(opening: string, closing: string): string {
  const start = source.indexOf(opening)
  if (start === -1) throw new Error(`could not find ${opening}`)
  const end = source.indexOf(closing, start)
  if (end === -1) throw new Error(`could not find the end of ${opening}`)
  return source.slice(start + opening.length, end)
}

const contractBody = block('export interface IpcContract {', '\n}')
const channelsBody = block('export const IPC_CHANNELS: IpcChannel[] = [', '\n]')

// Keys in the contract are declared as 'name': { req … }. Anything quoted
// that is not followed by a colon is prose in a comment.
const declared = [...contractBody.matchAll(/^\s*'([a-zA-Z]+:[a-zA-Z]+)':/gm)].map((m) => m[1]!)
const allowed = [...channelsBody.matchAll(/'([a-zA-Z]+:[a-zA-Z]+)'/g)].map((m) => m[1]!)

console.log('\nThe IPC contract and the preload allowlist')

check('the contract declares channels', declared.length > 0, declared.length)
check('the allowlist is not empty', allowed.length > 0, allowed.length)

const missing = declared.filter((name) => !allowed.includes(name))
check('every declared channel is allowed through the preload', missing.length === 0, missing)

const orphaned = allowed.filter((name) => !declared.includes(name))
check('every allowed channel is actually declared', orphaned.length === 0, orphaned)

const seen = new Set<string>()
const duplicated = allowed.filter((name) => (seen.has(name) ? true : (seen.add(name), false)))
check('no channel is listed twice', duplicated.length === 0, duplicated)

console.log('\nWhat the browser harnesses have to answer')

/*
 * Every harness boots the real renderer against a scripted bridge. Adding a
 * call to `bootstrap` therefore breaks every harness that has not been told
 * about it — the Promise.all comes back with an undefined in it, the store
 * takes it, and the whole application fails to render. The symptom is a dozen
 * harnesses failing at once on assertions that have nothing to do with the
 * change, which is a slow thing to read backwards.
 *
 * So the calls bootstrap makes are read out of the store and each stub is
 * checked for them here, where the failure names the missing channel.
 */
const store = readFileSync('src/renderer/src/store/useAppStore.ts', 'utf8')
// From the implementation, not the interface: `refreshPlaylists:` appears in
// the type declaration first, and slicing to that gives an empty string and a
// check that passes by examining nothing.
const bootstrapStart = store.indexOf('bootstrap: async')
const bootstrapBody = store.slice(bootstrapStart, store.indexOf('refreshPlaylists:', bootstrapStart))
const bootstrapCalls = [...new Set([...bootstrapBody.matchAll(/invoke\('([a-zA-Z]+:[a-zA-Z]+)'/g)].map((m) => m[1]!))]

check('bootstrap makes calls worth checking', bootstrapCalls.length > 0, bootstrapCalls)

const stubs = readdirSync('test/browser').filter((name) => name.includes('preload') && name.endsWith('.cjs'))
check('there are harness bridges to check', stubs.length > 0, stubs.length)

for (const stub of stubs) {
  const body = readFileSync(`test/browser/${stub}`, 'utf8')
  // Only files that actually script answers; a bridge doing something else is
  // not one of these.
  if (!body.includes('const answers')) continue

  const missing = bootstrapCalls.filter((name) => !body.includes(`'${name}'`))
  check(`${stub} answers everything bootstrap asks for`, missing.length === 0, missing)
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
