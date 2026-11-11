import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '@main/db'
import { buildPayload, importBackup } from '@main/secure/backup'
import {
  createFolder,
  listFolders,
  removeFolder,
  renameFolder,
  reorderFolders,
  setFolderCollapsed
} from '@main/db/repo/playlistFolders'
import {
  createPlaylist,
  listPlaylists,
  reorderPlaylists,
  setPlaylistFolder
} from '@main/db/repo/playlists'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

function threw(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

getDb()

console.log('\nNaming a folder')

const livingRoom = createFolder('Living room')
check('a folder can be made', livingRoom.id > 0)
check('and starts open', livingRoom.collapsed === false)
check('surrounding space is not part of the name', createFolder('  Study  ').name === 'Study')
check('nor is a run of it inside', createFolder('Back   bedroom').name === 'Back bedroom')
check('a blank name is refused', threw(() => createFolder('   ')))
check('an empty one too', threw(() => createFolder('')))

console.log('\nPutting sources in and taking them out')

const alpha = createPlaylist({ name: 'Alpha provider', kind: 'xtream', url: 'http://one.example:8080' })
const bravo = createPlaylist({ name: 'Bravo provider', kind: 'xtream', url: 'http://two.example:8080' })
const charlie = createPlaylist({ name: 'Charlie list', kind: 'm3u', url: 'http://three.example/p.m3u' })

check('a new source is ungrouped', alpha.folderId === null)

setPlaylistFolder(alpha.id, livingRoom.id)
setPlaylistFolder(bravo.id, livingRoom.id)

const inFolder = listPlaylists().filter((p) => p.folderId === livingRoom.id)
check('both sources are in the folder', inFolder.length === 2)
check(
  'and the one added second sits after the first',
  inFolder[0]?.id === alpha.id && inFolder[1]?.id === bravo.id,
  inFolder.map((p) => p.name)
)
check('the third is still ungrouped', listPlaylists().find((p) => p.id === charlie.id)?.folderId === null)

check('a source cannot be put in a folder that does not exist', threw(() => setPlaylistFolder(alpha.id, 9999)))

check('passing null takes it back out', setPlaylistFolder(alpha.id, null).folderId === null)

console.log('\nDeleting a folder')

// The behaviour this whole feature has to get right. A folder is a label; it
// is not a container that owns what it shows. Somebody tidying their sidebar
// must not lose a configured provider — and the credentials stored against it
// — because they deleted the box it was sitting in.
const beforeDelete = listPlaylists().length
removeFolder(livingRoom.id)

check('the folder is gone', listFolders().every((f) => f.id !== livingRoom.id))
check('every source survived it', listPlaylists().length === beforeDelete)
check(
  'and the one that was inside is merely ungrouped',
  listPlaylists().find((p) => p.id === bravo.id)?.folderId === null
)

console.log('\nOrder')

const study = listFolders().find((f) => f.name === 'Study')!
const backBedroom = listFolders().find((f) => f.name === 'Back bedroom')!

reorderFolders([backBedroom.id, study.id])
check(
  'folders take the order they are given',
  listFolders().map((f) => f.name).join(' < ') === 'Back bedroom < Study',
  listFolders().map((f) => f.name)
)

// A list assembled before something changed elsewhere should not be able to
// quietly drop whatever it has not heard of.
reorderFolders([study.id, 4242])
const afterStale = listFolders().map((f) => f.name)
check('an id that no longer exists is ignored', afterStale.length === 2, afterStale)
check('a folder left out of the list keeps a place', afterStale.includes('Back bedroom'), afterStale)
check('and the one that was named comes first', afterStale[0] === 'Study', afterStale)

reorderPlaylists([charlie.id, bravo.id, alpha.id])
check(
  'sources reorder the same way',
  listPlaylists().map((p) => p.id).join(',') === [charlie.id, bravo.id, alpha.id].join(','),
  listPlaylists().map((p) => p.name)
)

console.log('\nCollapsing')

setFolderCollapsed(study.id, true)
check('a folder can be shut', listFolders().find((f) => f.id === study.id)?.collapsed === true)
reorderFolders([backBedroom.id, study.id])
check(
  'and stays shut when it is moved',
  listFolders().find((f) => f.id === study.id)?.collapsed === true
)
setFolderCollapsed(study.id, false)
check('and can be opened again', listFolders().find((f) => f.id === study.id)?.collapsed === false)

console.log('\nRenaming')
check('a folder can be renamed', renameFolder(study.id, 'Office').name === 'Office')
check('a rename is cleaned up too', renameFolder(study.id, '  Office  two ').name === 'Office two')
check('and a blank rename is refused', threw(() => renameFolder(study.id, '  ')))

console.log('\nBackup')

const work = mkdtempSync(join(tmpdir(), 'libercast-folders-'))

// A folder is carried by name, never by id: the database being restored into
// numbers its rows differently, so an id from the exporting machine points at
// nothing or — worse — at something else.
setPlaylistFolder(alpha.id, backBedroom.id)
const payload = buildPayload(false)

check(
  'folders are exported in their own right',
  (payload.folders ?? []).some((f) => f.name === 'Back bedroom'),
  payload.folders
)
check(
  'an empty folder is exported too, not dropped for having nothing in it',
  (payload.folders ?? []).some((f) => f.name === 'Office two'),
  payload.folders
)
check(
  'a source names its folder rather than numbering it',
  payload.playlists.find((p) => p.name === 'Alpha provider')?.folder === 'Back bedroom'
)
check(
  'an ungrouped source says so',
  payload.playlists.find((p) => p.name === 'Charlie list')?.folder === null
)

async function restore(name: string, body: unknown): Promise<void> {
  const file = join(work, name)
  writeFileSync(file, JSON.stringify(body), 'utf8')
  await importBackup({ filePath: file, mode: 'merge' })
}

// Everything below runs after the synchronous checks above, so the summary
// line is printed from inside the promise chain rather than racing it.
void (async () => {
  // A backup written before folders existed has neither key. It must restore
  // without a compatibility branch and without inventing a folder.
  const legacy = {
    ...payload,
    folders: undefined,
    playlists: payload.playlists.map(({ folder: _folder, ...rest }) => rest)
  }
  let legacyFailed: unknown = null
  try {
    await restore('legacy.json', legacy)
  } catch (e) {
    legacyFailed = e
  }
  check('a backup made before folders existed still restores', legacyFailed === null, legacyFailed)

  // A source that is not here yet arrives in the folder it was filed under,
  // and that folder is created to receive it.
  await restore('fresh.json', {
    ...payload,
    folders: [{ name: 'Imported box', sortOrder: 0 }],
    playlists: [
      {
        name: 'Delta provider',
        kind: 'm3u',
        url: 'http://four.example/p.m3u',
        filePath: null,
        username: null,
        macAddress: null,
        epgUrl: null,
        epgOffsetMinutes: 0,
        userAgent: null,
        referrer: null,
        sortOrder: 9,
        folder: 'Imported box'
      }
    ],
    favorites: [],
    history: [],
    progress: []
  })

  const imported = listFolders().find((f) => f.name === 'Imported box')
  check('a folder named by a backup is created', imported !== undefined)
  check(
    'and the restored source lands in it',
    listPlaylists().find((p) => p.name === 'Delta provider')?.folderId === imported?.id
  )

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  process.exit(failures === 0 ? 0 : 1)
})()

