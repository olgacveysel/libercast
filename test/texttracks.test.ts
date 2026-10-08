import { anyShowing, disableOthers, ensureShowing, type TrackHost, type TrackLike } from '@renderer/features/player/textTracks'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

/** Just enough of a media element to exercise the track rules without a DOM. */
function host(...tracks: TrackLike[]): TrackHost & { tracks: TrackLike[] } {
  const list: TrackHost['textTracks'] = { length: tracks.length }
  tracks.forEach((track, index) => {
    list[index] = track
  })
  return { textTracks: list, tracks }
}

console.log('\nkeeping the right subtitle track on')

const stream: TrackLike = { mode: 'showing', label: 'Subtitles' }
const stale: TrackLike = { mode: 'showing', label: 'Old' }
const h = host(stale, stream)

disableOthers(h, stream)
check('the named track stays on', stream.mode === 'showing')
check('everything else goes off', stale.mode === 'disabled')

// The regression this module exists for: an effect that did not own the
// stream's track used to switch it off a moment after it was attached, so
// embedded subtitles never appeared.
const onlyStream: TrackLike = { mode: 'showing' }
disableOthers(host(onlyStream), onlyStream)
check('a lone stream track is not switched off by a pass that keeps it', onlyStream.mode === 'showing')

const external: TrackLike = { mode: 'showing', label: 'movie.srt' }
const embedded: TrackLike = { mode: 'showing', label: 'Subtitles' }
disableOthers(host(embedded, external), external)
check('an external file replaces the embedded track', embedded.mode === 'disabled' && external.mode === 'showing')

// Turning everything off has to be spelled out, so it cannot happen by accident.
const a: TrackLike = { mode: 'showing' }
const b: TrackLike = { mode: 'showing' }
disableOthers(host(a, b), null)
check('an explicit null switches every track off', a.mode === 'disabled' && b.mode === 'disabled')

console.log('\nsurviving a source change')

// Chromium resets tracks to `disabled` when the element gets a new src, which
// happens on every seek, track change and retry.
const reset: TrackLike = { mode: 'disabled', label: 'Subtitles' }
ensureShowing(reset)
check('a track reset by a reopen is turned back on', reset.mode === 'showing')

const untouched: TrackLike = { mode: 'showing' }
ensureShowing(untouched)
check('a track already showing is left alone', untouched.mode === 'showing')

ensureShowing(null)
check('no track is not an error', true)

console.log('\nreporting what is visible')

check('nothing showing is reported as such', !anyShowing(host({ mode: 'disabled' }, { mode: 'hidden' })))
check('one showing track is enough', anyShowing(host({ mode: 'disabled' }, { mode: 'showing' })))
check('an empty element shows nothing', !anyShowing(host()))

// A sparse list is what a media element gives after tracks are added and
// removed; skipping the holes must not throw.
const sparse = { textTracks: { length: 3, 0: { mode: 'showing' } } } as unknown as TrackHost
disableOthers(sparse, null)
check('gaps in the track list are skipped', true)

console.log(failures === 0 ? '\ntexttracks: all passed' : `\ntexttracks: ${failures} failed`)
if (failures > 0) process.exitCode = 1
