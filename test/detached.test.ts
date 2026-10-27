import {
  centeredIn,
  detachedQuery,
  detachedSize,
  nextAudioTile,
  parseDetached,
  pickDisplay,
  type DisplayInfo,
  type Rect
} from '@shared/detached'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const primary: DisplayInfo = {
  id: 1,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  primary: true
}
// A second monitor to the right, as most people have it.
const second: DisplayInfo = {
  id: 2,
  workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
  primary: false
}

console.log('\nChoosing the monitor')

check('with one display there is nothing to choose', pickDisplay([primary], 1)?.id === 1)
// The whole point of detaching: get the picture off the screen the grid is on.
check('a second display wins over the grid’s own', pickDisplay([primary, second], 1)?.id === 2)
check('and it works the other way round', pickDisplay([primary, second], 2)?.id === 1)
check(
  'an unknown grid display still picks something',
  pickDisplay([primary, second], 99)?.id === 1
)
check('no displays at all is null, not a crash', pickDisplay([], 1) === null)
check(
  'with no primary flagged the first display is used',
  pickDisplay([{ ...second, primary: false }], 2)?.id === 2
)

console.log('\nPlacing the window')

const onSecond = centeredIn(second.workArea, 1280, 720)
check('it opens on the chosen display, not at the origin', onSecond.x >= second.workArea.x, onSecond)
check('it is centred horizontally', onSecond.x === 1920 + Math.round((2560 - 1280) / 2), onSecond)
check('it is centred vertically', onSecond.y === Math.round((1400 - 720) / 2), onSecond)
check('it keeps the size it asked for', onSecond.width === 1280 && onSecond.height === 720)

// A window taller than the display would otherwise open with its controls
// below the bottom edge, where they cannot be reached.
const cramped = centeredIn({ x: 0, y: 0, width: 1024, height: 500 }, 1280, 720)
check('a window too wide is cut to the display', cramped.width === 1024, cramped)
check('a window too tall is cut too', cramped.height === 500, cramped)
check('and it still starts inside the display', cramped.x === 0 && cramped.y === 0, cramped)

const tiny = centeredIn({ x: 0, y: 0, width: 200, height: 100 }, 1280, 720)
check('there is a floor, so it never becomes unusable', tiny.width >= 320 && tiny.height >= 180, tiny)

console.log('\nHow big it opens')

check('a share of the display, not the whole thing', detachedSize(second.workArea).width === 1280)
check('it is capped on a very wide monitor', detachedSize({ x: 0, y: 0, width: 5120, height: 2160 }).width === 1280)
check('it shrinks with a small monitor', detachedSize({ x: 0, y: 0, width: 1280, height: 800 }).width === 768)
const size = detachedSize(second.workArea)
check('the shape is 16:9', Math.abs(size.width / size.height - 16 / 9) < 0.01, size)

console.log('\nWhere the grid’s sound goes')

// A detached window carries its own audio. Leaving the grid pointed at a tile
// that is no longer playing there would mute the grid for no visible reason.
check('an untouched tile keeps the sound', nextAudioTile(2, [], 4) === 2)
check('detaching another tile changes nothing', nextAudioTile(2, [0], 4) === 2)
check('detaching the audible tile moves the sound', nextAudioTile(2, [2], 4) === 0)
check('it moves to the first tile still in the grid', nextAudioTile(0, [0, 1], 4) === 2)
check('every tile detached leaves the grid silent', nextAudioTile(0, [0, 1], 2) === null)
check('a tile past the layout is not kept', nextAudioTile(7, [], 4) === 0)
check('a negative index is not kept', nextAudioTile(-1, [], 4) === 0)
check('no tiles at all is silence', nextAudioTile(0, [], 0) === null)

console.log('\nWhat the detached window is told')

// Through the URL rather than a message: the window has to know what to play
// before React mounts, and a message would arrive a frame too late.
const query = detachedQuery(42, 3)
check('the query names the channel', query.includes('channel=42'), query)
check('and the tile it came from', query.includes('tile=3'), query)
check('a round trip survives', parseDetached('?' + query)?.channelId === 42)
check('including the tile', parseDetached('?' + query)?.tile === 3)
check('the leading question mark is optional', parseDetached(query)?.channelId === 42)
check('tile zero is a real tile', parseDetached('?' + detachedQuery(7, 0))?.tile === 0)

check('the main window is not a detached one', parseDetached('') === null)
check('and neither is one without the flag', parseDetached('?channel=42&tile=1') === null)
check('a missing channel is refused', parseDetached('?detached=1&tile=1') === null)
check('a non-numeric channel is refused', parseDetached('?detached=1&channel=abc&tile=1') === null)
check('channel zero is refused', parseDetached('?detached=1&channel=0&tile=1') === null)
check('a negative tile is refused', parseDetached('?detached=1&channel=4&tile=-1') === null)
check('a fractional channel is refused', parseDetached('?detached=1&channel=4.5&tile=1') === null)

console.log(failures === 0 ? '\ndetached: all passed' : `\ndetached: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
