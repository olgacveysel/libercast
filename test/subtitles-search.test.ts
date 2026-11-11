import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { OpenSubtitlesClient, toHit } from '@main/sources/opensubtitles'
import { safeName } from '@main/media/subtitleSearch'
import { GOOD_KEY, GOOD_PASSWORD, GOOD_USER, startService, type Service } from './subtitleservice'

/**
 * What can and cannot be concluded from this file.
 *
 * It proves the client and the documented API agree, because it answers the
 * documented API. It cannot prove the client and the real OpenSubtitles agree
 * — nobody here has a key — so every claim below is about shapes and
 * failures, not about the service.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

async function failureOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const api = (service: Service, key = GOOD_KEY): OpenSubtitlesClient =>
  new OpenSubtitlesClient(key, 5000, `${service.url}/api/v1`)

async function main(): Promise<void> {
  console.log('\nReading one result')

  check('a row with a file becomes a result',
    toHit({ attributes: { language: 'en', download_count: 9, files: [{ file_id: 7, file_name: 'a.srt' }] } })
      ?.fileId === 7)

  // A result that cannot be downloaded is a choice that fails when taken,
  // which is worse than one fewer choice.
  check('a row with no file is dropped',
    toHit({ attributes: { language: 'en', files: [] } }) === null)
  check('a row with no attributes is dropped', toHit({ id: '1' }) === null)
  check('a missing download count reads as zero',
    toHit({ attributes: { files: [{ file_id: 1 }] } })?.downloads === 0)
  check('a file with no name still gets one',
    toHit({ attributes: { files: [{ file_id: 42 }] } })?.fileName === 'subtitle-42')

  console.log('\nNaming a downloaded file')

  // The name comes from whoever uploaded the subtitle, so it is somebody
  // else's string about to become a path.
  check('a traversal attempt cannot climb out',
    !safeName('../../../etc/passwd').includes('..'), safeName('../../../etc/passwd'))
  check('separators do not survive',
    !/[\\/\\\\]/.test(safeName('a/b\\\\c.srt')), safeName('a/b\\\\c.srt'))
  check('the extension is kept, because the loader reads it',
    safeName('Some Film (2019).srt').endsWith('.srt'))
  check('an empty name still produces one', safeName('') === 'subtitle.srt')
  check('a name of only separators produces one', safeName('///') === 'subtitle.srt')

  /*
   * The guarantee underneath all of the above: whatever the service sends,
   * the file lands inside the folder meant for it.
   *
   * Asked through `relative` rather than by comparing strings. The first
   * version of this compared against a hard-coded '/tmp/holding/' prefix,
   * which passes on Linux and fails on Windows for results that are
   * perfectly correct — `join` returns backslashes there. A test that is
   * green on the CI platform and red on the developer's is worse than no
   * test: it is a false assurance plus a distraction.
   */
  const holding = join(tmpdir(), 'libercast-holding')
  const staysInside = (name: string): boolean => {
    const step = relative(holding, resolve(holding, safeName(name)))
    return step !== '' && !step.startsWith('..') && !isAbsolute(step)
  }

  for (const nasty of [
    '../../../etc/passwd',
    '..\\..\\windows\\system32',
    '....//....//x',
    '/abs/olute',
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    '..'
  ]) {
    check(`"${nasty}" stays inside the folder`, staysInside(nasty), resolve(holding, safeName(nasty)))
  }

  console.log('\nAgainst a service that answers the documented way')

  const service = await startService({ results: 3 })

  const hits = await api(service).search({ query: 'the quiet harbour', languages: ['eng'] })
  check('results come back', hits.length === 3, hits.length)
  check('most downloaded first, as asked for', hits[0]!.downloads >= hits[1]!.downloads)
  check('the file id is carried, since downloading needs it', hits[0]!.fileId === 500)
  check('the hearing-impaired flag survives', hits.some((hit) => hit.hearingImpaired))

  // The key identifies the application and is required on every call,
  // searches included — which is the whole reason this feature is off until
  // a user supplies one.
  check('the key was sent on the search', service.seen.keys.includes(GOOD_KEY), service.seen.keys)
  check('and it travelled in a header, not the URL',
    service.seen.paths.every((path) => !path.includes(GOOD_KEY)), service.seen.paths)
  check('the application named itself, as the service asks',
    service.seen.userAgents.some((agent) => agent?.includes('LiberCast')), service.seen.userAgents)

  console.log('\nSigning in')

  const signedIn = api(service)
  await signedIn.login(GOOD_USER, GOOD_PASSWORD)
  await signedIn.search({ query: 'x', languages: [] })
  check('the token is sent after signing in',
    service.seen.authorizations.some((value) => value?.startsWith('Bearer ')),
    service.seen.authorizations)

  const badLogin = await failureOf(() => api(service).login(GOOD_USER, 'wrong'))
  check('a rejected sign-in says so', badLogin?.includes('username or password') === true, badLogin)

  console.log('\nDownloading')

  const link = await api(service).downloadLink(500)
  check('a link comes back', link.url.startsWith('http://'), link.url)
  check('and the name the service chose', link.fileName === 'quiet-harbour.srt', link.fileName)
  // The allowance is the user's, not the key's. Reporting it is what lets the
  // interface say how many are left instead of letting somebody find out.
  check('the remaining allowance is reported', link.quota.remaining === 17, link.quota)

  service.close()

  console.log('\nWhen it goes wrong')

  const wrongKey = await startService()
  const keyError = await failureOf(() => api(wrongKey, 'not-the-key').search({ query: 'x', languages: [] }))
  check('a key the service does not know points at Settings',
    keyError?.includes('API key') === true && keyError?.includes('Settings') === true, keyError)
  check('and does not claim the sign-in was wrong',
    keyError?.includes('username') !== true, keyError)
  wrongKey.close()

  const spent = await startService({ quotaSpent: true })
  const spentError = await failureOf(() => api(spent).downloadLink(500))
  check('an exhausted allowance says it is exhausted',
    spentError?.includes('allowance') === true, spentError)
  // The actionable half: the limit is per user, so an account raises it.
  check('and says signing in raises it', spentError?.includes('Signing in') === true, spentError)
  spent.close()

  const slow = await startService({ rateLimited: 30 })
  const slowError = await failureOf(() => api(slow).search({ query: 'x', languages: [] }))
  check('being asked to slow down says how long', slowError?.includes('30 seconds') === true, slowError)
  slow.close()

  const messy = await startService({ results: 2, includeUnusable: true })
  const mixed = await api(messy).search({ query: 'x', languages: [] })
  check('an unusable row is not offered', mixed.length === 2, mixed.length)
  messy.close()

  const empty = await startService({ results: 0 })
  check('no results is not an error', (await api(empty).search({ query: 'x', languages: [] })).length === 0)
  empty.close()

  console.log('\nRefusing to work without a key')

  check('an empty key is refused before any request is made',
    (await failureOf(async () => new OpenSubtitlesClient(''))) !== null)
  check('and so is whitespace',
    (await failureOf(async () => new OpenSubtitlesClient('   '))) !== null)

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

void main().catch((error) => {
  console.error('\nTest run threw:', error)
  process.exit(1)
})
