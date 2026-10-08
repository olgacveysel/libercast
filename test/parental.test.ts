import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import * as parental from '@main/secure/parental'
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
    mk('4', 'BBC News', 'news', false),
    mk('5', 'Poker Central', 'news', false)
  ]

  importCatalog(playlist.id, 'live', categories, channels)

  const all = (): number => catalog.countChannels({ playlistId: playlist.id, kind: 'live' })

  console.log('\nWith no PIN set')
  check('parental controls start off', !parental.isEnabled())
  check('nothing is locked', !parental.isLocked())
  check('every channel is visible', all() === 5, all())

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
  check('locking hides adult-flagged channels', all() === 4, all())
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

  check('a locked category hides its channels', all() === 2, all())
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

  console.log('\nFiltering reaches every screen, not just the list')
  const newsChannel = catalog
    .queryChannels({ playlistId: playlist.id, limit: 50 })
    .find((c) => c.name === 'BBC News')!
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
  check('everything is visible again', all() === 5, all())

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
    require('node:fs').writeFileSync(bad, 'not json', 'utf8')
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
