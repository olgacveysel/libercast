import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import * as parental from '@main/secure/parental'
import { assertNetworkStream, resolveProviderStream } from '@main/media/resolve'
import { buildPayload, decryptPayload, encryptPayload, exportBackup, importBackup, isEncrypted } from '@main/secure/backup'
import { readFileSync } from 'node:fs'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const work = mkdtempSync(join(tmpdir(), 'libercast-parental-'))

async function main(): Promise<void> {
  getDb()

  const playlist = createPlaylist({ name: 'Provider', kind: 'xtream', url: 'http://x', username: 'u' })

  const categories = [
    { externalId: 'kids', name: 'Kids' },
    { externalId: 'adult', name: 'Adult XXX' },
    { externalId: 'news', name: 'News' }
  ]

  const channels = [
    mk('1', 'Cartoon Time', 'kids', false),
    mk('2', 'Kids Movies', 'kids', false),
    mk('3', 'Late Night XXX', 'adult', true),
    mk('4', 'Civic News', 'news', false),
    mk('5', 'Poker Central', 'news', false),
    // Accents and punctuation, which is where the two halves of the lock used
    // to disagree: the list filter matches the folded name, the play-time
    // check used the raw one.
    mk('6', 'Pôker-Gecesi!', 'news', false)
  ]

  importCatalog(playlist.id, 'live', categories, channels)

  const all = (): number => catalog.countChannels({ playlistId: playlist.id, kind: 'live' })

  console.log('\nWith no PIN set')
  check('parental controls start off', !parental.isEnabled())
  check('nothing is locked', !parental.isLocked())
  check('every channel is visible', all() === 6, all())

  console.log('\nSetting a PIN')
  parental.setPin(null, '1234')
  check('controls are now enabled', parental.isEnabled())
  check('setting a PIN also unlocks the session', !parental.isLocked())

  let rejected = false
  try {
    parental.setPin(null, '4321')
  } catch {
    rejected = true
  }
  check('changing the PIN needs the current one', rejected)
  check('a short PIN is refused', (() => {
    try {
      parental.setPin('1234', '12')
      return false
    } catch {
      return true
    }
  })())

  console.log('\nVerification')
  check('the correct PIN verifies', parental.verify('1234'))
  check('a wrong PIN does not', !parental.verify('9999'))
  check('an empty PIN does not', !parental.verify(''))

  const db = getDb()
  const stored = db.prepare("SELECT value FROM settings WHERE key = 'parental:hash'").get() as
    | { value: string }
    | undefined
  check('the PIN itself is never stored', stored !== undefined && !stored.value.includes('1234'))

  console.log('\nFiltering while locked')
  parental.setRules({
    lockedCategoryIds: [],
    keywords: [],
    lockAdult: true,
    autoLockMinutes: 0
  })
  parental.lock()
  check('locking hides adult-flagged channels', all() === 5, all())
  check(
    'the adult channel is gone from queries',
    !catalog.queryChannels({ playlistId: playlist.id, limit: 50 }).some((c) => c.name.includes('XXX'))
  )

  // Locking a category has to hide the category itself, not just its contents.
  const kidsCategory = (() => {
    parental.unlock('1234')
    const found = catalog.listCategories(playlist.id, 'live').find((c) => c.name === 'Kids')!
    return found
  })()

  parental.setRules({
    lockedCategoryIds: [kidsCategory.id],
    keywords: [],
    lockAdult: true,
    autoLockMinutes: 0
  })
  parental.lock()

  check('a locked category hides its channels', all() === 3, all())
  check(
    'and the category disappears from the sidebar',
    !catalog.listCategories(playlist.id, 'live').some((c) => c.name === 'Kids')
  )

  parental.unlock('1234')
  parental.setRules({
    lockedCategoryIds: [],
    keywords: ['poker'],
    lockAdult: false,
    autoLockMinutes: 0
  })
  parental.lock()
  check('a blocked word hides matching titles', all() === 4, all())
  check(
    'and only the matching one',
    !catalog.queryChannels({ playlistId: playlist.id, limit: 50 }).some((c) => c.name === 'Poker Central')
  )

  /*
   * Hidden and playable was the worst of both.
   *
   * Lists filter on `name_folded` — accents stripped, punctuation collapsed —
   * while the check that decides whether something actually plays used a
   * plain `toLowerCase()`. "Pôker-Gecesi!" folds to "poker gecesi" and so
   * disappeared from every list under the keyword "poker", then played
   * perfectly when opened from a favourite or typed on the remote.
   *
   * The invariant is the point, not either half: anything a list hides must
   * refuse to play, and anything it shows must play. Checked across the whole
   * catalogue so a future divergence of any kind is caught, not just this one.
   */
  console.log('\nWhat the lists hide and what will play')
  check(
    'an accented name is hidden too',
    !catalog.queryChannels({ playlistId: playlist.id, limit: 50 }).some((c) => c.name === 'Pôker-Gecesi!')
  )

  const visible = new Set(
    catalog.queryChannels({ playlistId: playlist.id, limit: 100 }).map((c) => c.id)
  )
  parental.unlock('1234')
  const everything = catalog.queryChannels({ playlistId: playlist.id, limit: 100 })
  parental.lock()

  const disagreements = everything.filter((channel) => {
    const blocked = parental.isBlocked({
      categoryId: channel.categoryId,
      isAdult: channel.isAdult,
      name: channel.name
    })
    return blocked === visible.has(channel.id)
  })

  check(
    'every hidden channel also refuses to play, and no shown one does',
    disagreements.length === 0,
    disagreements.map((c) => c.name)
  )

  /*
   * The lock is on watching, not on acquiring.
   *
   * The first version of this checked wherever a stream was fetched, which
   * swept up the recorder — so a recording a parent scheduled while unlocked
   * was refused at two in the morning when the auto-lock had re-engaged on
   * its own. A decision already made, undone by a timer, silently.
   *
   * Writing a locked channel to disk shows a child nothing; playing the file
   * back shows them everything, and that is where the check now sits.
   *
   * The assertion is about which refusal, not whether there is one: resolving
   * for real needs a provider, and this catalogue has none. A 'record' that
   * fails for some other reason is fine. A 'record' that fails because the
   * channel is locked is the regression.
   */
  /*
   * What a playlist is allowed to point at.
   *
   * An M3U is somebody else's text file, and the address on its `#EXTINF`
   * line goes to ffmpeg — which opens far more than http. `file:` reads any
   * file this application can read, `concat:` reads a list of them, and a
   * bare path needs no scheme at all. The protocols a stream may actually
   * use are named instead.
   */
  console.log('\nWhat a source may point at')

  function refusesUrl(url: string): boolean {
    try {
      assertNetworkStream(url)
      return false
    } catch {
      return true
    }
  }

  for (const allowed of [
    'http://example.test/live/1.ts',
    'https://example.test/live/1.m3u8',
    'rtmp://example.test/live/1',
    'rtsp://camera.test:554/stream',
    // The shape a multicast feed arrives in, which `new URL` will not parse —
    // one reason this is not written with `new URL`.
    'udp://@239.0.0.1:1234',
    'srt://example.test:9000'
  ]) {
    check(`"${allowed.slice(0, 28)}" plays`, !refusesUrl(allowed))
  }

  for (const refused of [
    'file:///etc/passwd',
    'concat:/etc/passwd|/etc/shadow',
    'data:video/mp4;base64,AAAA',
    'pipe:0',
    'subfile,,start,0,end,100,,:/etc/passwd',
    '/etc/passwd',
    './relative.ts',
    // A Windows drive letter parses as a scheme, which is exactly how a local
    // path would have slipped through a naive check.
    'C:\\Windows\\win.ini',
    ''
  ]) {
    check(`"${refused.slice(0, 28)}" does not`, refusesUrl(refused))
  }

  console.log('\nWhy the stream is being fetched')

  const locked = everything.find((c) =>
    parental.isBlocked({ categoryId: c.categoryId, isAdult: c.isAdult, name: c.name })
  )!

  async function refusalFor(purpose: 'play' | 'record' | 'download' | 'scan'): Promise<string> {
    try {
      await resolveProviderStream({ type: 'channel', id: locked.id }, purpose)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  check('a locked channel will not play', /locked/i.test(await refusalFor('play')))
  check('but recording it is not refused for being locked', !/locked/i.test(await refusalFor('record')))
  check('nor is downloading it', !/locked/i.test(await refusalFor('download')))
  check('nor is the health scan', !/locked/i.test(await refusalFor('scan')))

  console.log('\nFiltering reaches every screen, not just the list')
  const newsChannel = catalog
    .queryChannels({ playlistId: playlist.id, limit: 50 })
    .find((c) => c.name === 'Civic News')!
  catalog.markWatched(newsChannel.id)

  parental.unlock('1234')
  const pokerId = catalog.queryChannels({ playlistId: playlist.id, limit: 50 }).find((c) => c.name === 'Poker Central')!.id
  catalog.markWatched(pokerId)
  catalog.toggleFavorite(pokerId)
  parental.lock()

  check(
    'recent channels exclude blocked titles',
    !catalog.recentChannels(20).some((c) => c.name === 'Poker Central')
  )
  check(
    'favorites exclude blocked titles',
    !catalog
      .queryChannels({ playlistId: playlist.id, favoritesOnly: true, limit: 20 })
      .some((c) => c.name === 'Poker Central')
  )
  check(
    'a search cannot reach a blocked title',
    catalog.queryChannels({ playlistId: playlist.id, search: 'poker', limit: 20 }).length === 0
  )

  console.log('\nUnlocking and auto-lock')
  check('the wrong PIN does not unlock', !parental.unlock('0000'))
  check('the right PIN does', parental.unlock('1234'))
  check('everything is visible again', all() === 6, all())

  parental.setRules({ lockedCategoryIds: [], keywords: [], lockAdult: true, autoLockMinutes: 0 })
  check('rules cannot be changed while locked', (() => {
    parental.lock()
    try {
      parental.setRules({ lockedCategoryIds: [], keywords: [], lockAdult: false, autoLockMinutes: 0 })
      return false
    } catch {
      return true
    }
  })())

  console.log('\nBackup round trip')
  parental.unlock('1234')
  parental.setRules({ lockedCategoryIds: [], keywords: [], lockAdult: false, autoLockMinutes: 0 })

  const favouriteId = catalog.queryChannels({ playlistId: playlist.id, limit: 1 })[0]!.id
  catalog.toggleFavorite(favouriteId)

  const plain = join(work, 'backup.json')
  const summary = await exportBackup(plain, { includeCredentials: false })
  check('export writes a file', summary.bytes > 0)
  check('it records the source', summary.playlists === 1)
  check('it is not encrypted', !summary.encrypted)

  const raw = JSON.parse(readFileSync(plain, 'utf8')) as Record<string, unknown>
  check('a plain backup is readable JSON', raw.format === 'libercast-backup')
  check('and carries no password', !JSON.stringify(raw).includes('password'))

  console.log('\nEncryption')
  const envelope = encryptPayload('{"secret":true}', 'hunter2')
  check('the envelope is marked encrypted', isEncrypted(envelope))
  check('the ciphertext does not contain the plaintext', !envelope.data.includes('secret'))
  check('the right passphrase decrypts', decryptPayload(envelope, 'hunter2') === '{"secret":true}')
  check('a wrong passphrase is rejected, not garbled', (() => {
    try {
      decryptPayload(envelope, 'wrong')
      return false
    } catch (error) {
      return String(error).includes('does not open')
    }
  })())

  check('credentials require a passphrase', await refuses(() => exportBackup(join(work, 'x.json'), { includeCredentials: true })))

  console.log('\nGuessing the PIN costs something')

// The PIN set earlier in this file is still '1234'.
parental.lock()

// scrypt already makes each guess slow. A limit is the other half: unattended,
// a tenth of a second per try still walks all 10,000 four-digit PINs overnight.
let refused: string | null = null
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    parental.unlock('0000')
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error)
    break
  }
}
check('repeated wrong PINs stop being accepted', refused !== null, refused)
check('and the refusal says how long to wait', refused?.includes('seconds') === true, refused)
check('a cooldown is reported', parental.attemptCooldownMs() > 0, parental.attemptCooldownMs())

// And the right PIN is refused too while the cooldown runs — otherwise the
// limit would only slow down someone who kept guessing wrong.
let rightPinDuringCooldown: string | null = null
try {
  parental.unlock('1234')
} catch (error) {
  rightPinDuringCooldown = error instanceof Error ? error.message : String(error)
}
check('even the correct PIN waits out the cooldown', rightPinDuringCooldown !== null)

/*
 * The cooldown has to cover every door that takes the PIN.
 *
 * It used to live inside `unlock`, which left two others with no counting at
 * all: `setPin` takes the current PIN, and `disable` takes the PIN. An
 * attacker sitting at the machine could walk the whole four-digit space
 * through the "change PIN" dialog without ever being made to wait — through
 * the form whose entire purpose is to require the PIN.
 *
 * Checked while the cooldown from above is still running, so this needs no
 * second lockout of its own.
 */
let setPinDuringCooldown: string | null = null
try {
  parental.setPin('1234', '5678')
} catch (error) {
  setPinDuringCooldown = error instanceof Error ? error.message : String(error)
}
check(
  'changing the PIN waits out the cooldown too',
  setPinDuringCooldown?.includes('Too many wrong attempts') === true,
  setPinDuringCooldown
)

let disableDuringCooldown: string | null = null
try {
  parental.disable('1234')
} catch (error) {
  disableDuringCooldown = error instanceof Error ? error.message : String(error)
}
check(
  'and so does turning parental controls off',
  disableDuringCooldown?.includes('Too many wrong attempts') === true,
  disableDuringCooldown
)
check('which are still on', parental.isEnabled())

console.log('\nRestore')
  const payload = buildPayload(false)
  check('the payload references channels by provider id, not row id', (() => {
    const favorite = payload.favorites[0]
    return favorite !== undefined && typeof favorite.externalId === 'string' && favorite.externalId !== ''
  })())

  // Restoring into the same database must not duplicate the source.
  const restored = await importBackup({ filePath: plain, mode: 'merge' })
  check('merging an existing source adds no duplicate', restored.playlists === 0, restored.playlists)
  check('favorites reattach', restored.favorites >= 1, restored.favorites)
  check(
    'and the source is still there exactly once',
    (getDb().prepare('SELECT COUNT(*) AS n FROM playlists').get() as { n: number }).n === 1
  )
  check('an Xtream source with no stored password is reported', restored.needCredentials.length >= 0)

  check('a corrupt file is rejected clearly', await refuses(async () => {
    const bad = join(work, 'bad.json')
    writeFileSync(bad, 'not json', 'utf8')
    await importBackup({ filePath: bad, mode: 'merge' })
  }))
}

async function refuses(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return false
  } catch {
    return true
  }
}

function mk(externalId: string, name: string, category: string, isAdult: boolean) {
  return {
    externalId,
    name,
    categoryExternalId: category,
    number: null,
    logoUrl: null,
    epgChannelId: null,
    streamUrl: `http://x/${externalId}.ts`,
    containerExtension: 'ts',
    isAdult
  }

}

void main().then(
  () => {
    console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
    process.exit(failures === 0 ? 0 : 1)
  },
  (error) => {
    console.error('\nTest run threw:', error)
    process.exit(1)
  }
)
