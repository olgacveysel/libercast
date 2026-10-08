import {
  MAX_SUBTITLE_SCALE,
  MIN_SUBTITLE_SCALE,
  normalizeSubtitleStyle,
  subtitleCss,
  subtitlePreviewStyle,
  withAlpha
} from '@renderer/features/player/subtitleStyle'
import { DEFAULT_SETTINGS } from '@shared/types'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nReading the settings back')

const defaults = normalizeSubtitleStyle(DEFAULT_SETTINGS)
check('the shipped defaults survive normalisation', defaults.scale === 1 && defaults.color === '#ffffff', defaults)
check('the default has a box behind the text', defaults.backgroundOpacity > 0)

// Settings are JSON on disk, so anything can be in there. None of these should
// produce subtitles that are invisible or fill the screen.
check('a missing value falls back', normalizeSubtitleStyle({}).scale === 1)
check('a huge size is clamped', normalizeSubtitleStyle({ subtitleScale: 40 }).scale === MAX_SUBTITLE_SCALE)
check('a tiny size is clamped', normalizeSubtitleStyle({ subtitleScale: 0.01 }).scale === MIN_SUBTITLE_SCALE)
check('a negative size is clamped', normalizeSubtitleStyle({ subtitleScale: -3 }).scale === MIN_SUBTITLE_SCALE)
check(
  'NaN is not a size',
  normalizeSubtitleStyle({ subtitleScale: Number.NaN }).scale === 1,
  normalizeSubtitleStyle({ subtitleScale: Number.NaN })
)
// Infinity is not a finite number, so it is treated as missing rather than as
// "as large as possible" — a settings file with a bad value gets the default,
// not the biggest subtitles the app can draw.
check(
  'Infinity is not a size',
  normalizeSubtitleStyle({ subtitleScale: Number.POSITIVE_INFINITY }).scale === 1
)
check('opacity above 1 is clamped', normalizeSubtitleStyle({ subtitleBackgroundOpacity: 4 }).backgroundOpacity === 1)
check('opacity below 0 is clamped', normalizeSubtitleStyle({ subtitleBackgroundOpacity: -1 }).backgroundOpacity === 0)
check('zero opacity is kept, not treated as missing', normalizeSubtitleStyle({ subtitleBackgroundOpacity: 0 }).backgroundOpacity === 0)
check('an unknown edge falls back', normalizeSubtitleStyle({ subtitleEdge: 'glow' as never }).edge === 'shadow')
check('an unknown typeface falls back', normalizeSubtitleStyle({ subtitleFont: 'comic' as never }).font === 'sans')
check('a chosen edge is kept', normalizeSubtitleStyle({ subtitleEdge: 'outline' }).edge === 'outline')

console.log('\nColours')

check('a short hex is accepted', normalizeSubtitleStyle({ subtitleColor: '#FF0' }).color === '#ff0')
check('a long hex is accepted', normalizeSubtitleStyle({ subtitleColor: '#F5E050' }).color === '#f5e050')
check('whitespace is tolerated', normalizeSubtitleStyle({ subtitleColor: '  #123456 ' }).color === '#123456')
check('a colour name is refused', normalizeSubtitleStyle({ subtitleColor: 'red' }).color === '#ffffff')
check('a number is refused', normalizeSubtitleStyle({ subtitleColor: 16 as never }).color === '#ffffff')

// These strings are interpolated into a stylesheet. A value that could close
// the rule and open another one has to be refused, not escaped.
const injected = normalizeSubtitleStyle({ subtitleColor: 'red; } body { display: none' })
check('a value that could break out of the rule is refused', injected.color === '#ffffff', injected)
check(
  'nothing hostile reaches the stylesheet',
  !subtitleCss(injected).includes('display: none'),
  subtitleCss(injected)
)

check('alpha is applied to a hex', withAlpha('#000000', 0.5) === 'rgba(0, 0, 0, 0.5)')
check('alpha works on a short hex', withAlpha('#fff', 1) === 'rgba(255, 255, 255, 1)')

console.log('\nThe generated rule')

const css = subtitleCss(normalizeSubtitleStyle({ ...DEFAULT_SETTINGS, subtitleScale: 1.5 }))
check('it targets the cue pseudo-element', css.startsWith('video::cue {'), css)
check('it is a closed rule', css.trimEnd().endsWith('}'), css)
check('the size is relative to the picture', css.includes('font-size: 1.5em'), css)
check('the colour is written literally', css.includes('color: #ffffff'), css)
check('the box carries its opacity', css.includes('rgba(0, 0, 0, 0.72)'), css)

// `::cue` is not reached by custom properties in Chromium, which is the whole
// reason this is generated rather than declared once with variables.
check('no custom properties are relied on', !css.includes('var('), css)

const noBox = subtitleCss(normalizeSubtitleStyle({ ...DEFAULT_SETTINGS, subtitleBackgroundOpacity: 0 }))
check('no box means transparent, not rgba(…, 0)', noBox.includes('background: transparent'), noBox)

const outlined = subtitleCss(normalizeSubtitleStyle({ ...DEFAULT_SETTINGS, subtitleEdge: 'outline' }))
// Eight offset copies: the four sides and the four corners. Fewer leaves a gap
// that shows as a nick in the letterform at the sizes people actually use.
const outlineShadow = /text-shadow: ([^;]+);/.exec(outlined)?.[1] ?? ''
check(
  'an outline is drawn all the way round',
  (outlineShadow.match(/rgba\(/g) ?? []).length === 8,
  outlineShadow
)

const plain = subtitleCss(normalizeSubtitleStyle({ ...DEFAULT_SETTINGS, subtitleEdge: 'none' }))
check('no edge means no shadow declaration', !plain.includes('text-shadow'), plain)

// White text needs a dark edge and black text needs a light one, or the edge
// disappears into the letters it is supposed to separate.
const onWhite = subtitleCss(normalizeSubtitleStyle({ ...DEFAULT_SETTINGS, subtitleColor: '#ffffff' }))
const onBlack = subtitleCss(normalizeSubtitleStyle({ ...DEFAULT_SETTINGS, subtitleColor: '#000000' }))
check('light text gets a dark edge', onWhite.includes('rgba(0, 0, 0, 0.9)'), onWhite)
check('dark text gets a light edge', onBlack.includes('rgba(255, 255, 255, 0.85)'), onBlack)

console.log('\nThe settings preview')

const preview = subtitlePreviewStyle(normalizeSubtitleStyle({ ...DEFAULT_SETTINGS, subtitleScale: 2 }))
// The preview has no video to take a base size from, so it cannot use em.
check('the preview sizes in rem', preview.fontSize!.endsWith('rem'), preview)
check('the preview shows the chosen colour', preview.color === '#ffffff', preview)
check('the preview shows the box', preview.background === 'rgba(0, 0, 0, 0.72)', preview)

console.log(failures === 0 ? '\nsubtitlestyle: all passed' : `\nsubtitlestyle: ${failures} failed`)
if (failures > 0) process.exitCode = 1
