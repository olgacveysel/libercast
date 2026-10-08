/**
 * What is inside an asar, and how big.
 *
 * `asar list` prints paths but no sizes, so a bloated package tells you nothing
 * about which part is bloated. This reads the archive's own header — a JSON
 * index at the front of the file — and adds the sizes up by top-level folder.
 *
 * No dependencies on purpose: it has to run on a machine where the only thing
 * that is certain is Node.
 *
 *   node tools/asar-report.mjs [path-to-app.asar]
 */
import { openSync, readSync, closeSync, statSync } from 'node:fs'

const target = process.argv[2] ?? 'release/win-unpacked/resources/app.asar'

let fd
try {
  fd = openSync(target, 'r')
} catch {
  console.error(`Cannot open ${target}`)
  console.error('Pass the path as an argument if your build output is elsewhere.')
  process.exit(1)
}

// asar header: 4 bytes of pickle framing, then a UInt32 giving the length of
// the JSON index that follows at offset 16.
const prefix = Buffer.alloc(16)
readSync(fd, prefix, 0, 16, 0)
const headerSize = prefix.readUInt32LE(12)

const raw = Buffer.alloc(headerSize)
readSync(fd, raw, 0, headerSize, 16)
closeSync(fd)

const index = JSON.parse(raw.toString('utf8').replace(/\0+$/, ''))

const totals = new Map()
let packed = 0
let unpacked = 0

/** Adds every file under `node`, crediting it to the top-level folder `bucket`. */
function walk(node, bucket, depth) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const where = depth === 0 ? name : bucket
    if (entry.files) {
      walk(entry, where, depth + 1)
      continue
    }
    const size = entry.size ?? 0
    // An unpacked file sits beside the archive rather than inside it, so it is
    // counted separately — it is not what makes the asar itself large.
    if (entry.unpacked) unpacked += size
    else {
      packed += size
      totals.set(where, (totals.get(where) ?? 0) + size)
    }
  }
}

walk(index, '', 0)

const mb = (bytes) => (bytes / 1048576).toFixed(1).padStart(8) + ' MB'

console.log(`\n${target}`)
console.log(`on disk${mb(statSync(target).size)}\n`)
console.log('Inside the archive, by top-level entry:\n')

for (const [name, size] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`${mb(size)}  ${name}`)
}

console.log(`\n${mb(packed)}  total stored in the asar`)
console.log(`${mb(unpacked)}  listed but unpacked (lives in app.asar.unpacked)`)
console.log('\nA healthy build stores about 14 MB in the asar.\n')
