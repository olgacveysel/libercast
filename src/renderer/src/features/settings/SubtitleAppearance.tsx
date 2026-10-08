import type { JSX } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'
import { useT } from '@renderer/i18n'
import {
  SUBTITLE_SCALES,
  normalizeSubtitleStyle,
  subtitlePreviewStyle,
  type SubtitleEdge,
  type SubtitleFont
} from '@renderer/features/player/subtitleStyle'
import { DEFAULT_SETTINGS } from '@shared/types'

/** Text colours worth offering, and no more than fit on one row. */
const TEXT_COLORS = ['#ffffff', '#f5e050', '#35d6e6', '#6fe07a', '#000000']

/** Box colours. Black is what everyone expects; the others suit a light theme. */
const BOX_COLORS = ['#000000', '#202020', '#16233d', '#ffffff']

const OPACITIES: [labelKey: 'none' | 'light' | 'default' | 'solid', value: number][] = [
  ['none', 0],
  ['light', 0.35],
  ['default', 0.72],
  ['solid', 1]
]

const EDGES: SubtitleEdge[] = ['none', 'shadow', 'outline']
const FONTS: SubtitleFont[] = ['sans', 'serif', 'mono']

/**
 * Subtitle appearance, with a live sample.
 *
 * The sample matters more than usual here: a subtitle is only readable in
 * context, over moving pictures, and the alternative is changing a value,
 * closing Settings, finding a film with subtitles, and waiting for a line.
 */
export function SubtitleAppearance(): JSX.Element {
  const { settings, updateSettings } = useAppStore()
  const t = useT()
  const style = normalizeSubtitleStyle(settings)

  const sizeLabels = ['subtitleSmall', 'subtitleDefault', 'subtitleLarge', 'subtitleLarger', 'subtitleLargest'] as const

  return (
    <section className="settings__group">
      <h3>{t('settings.subtitles')}</h3>

      <p className="settings__note">{t('settings.subtitlesBody')}</p>

      <div className="subpreview" aria-hidden="true">
        <span className="subpreview__cue" style={subtitlePreviewStyle(style)}>
          {t('settings.subtitleSample')}
        </span>
      </div>

      <div className="settings__row">
        <div>
          <strong>{t('settings.subtitleSize')}</strong>
          <span>{t('settings.subtitleSizeBody')}</span>
        </div>
        <div className="segmented">
          {SUBTITLE_SCALES.map((scale, index) => (
            <button
              key={scale}
              aria-pressed={style.scale === scale}
              onClick={() => void updateSettings({ subtitleScale: scale })}
            >
              {t(`settings.${sizeLabels[index]!}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings__row">
        <div>
          <strong>{t('settings.subtitleColor')}</strong>
          <span>{t('settings.subtitleColorBody')}</span>
        </div>
        <div className="swatches">
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              className="swatch"
              style={{ background: color }}
              aria-pressed={style.color === color}
              aria-label={`${t('settings.subtitleColor')} ${color}`}
              onClick={() => void updateSettings({ subtitleColor: color })}
            />
          ))}
        </div>
      </div>

      <div className="settings__row">
        <div>
          <strong>{t('settings.subtitleBackground')}</strong>
          <span>{t('settings.subtitleBackgroundBody')}</span>
        </div>
        <div className="swatches">
          {BOX_COLORS.map((color) => (
            <button
              key={color}
              className="swatch"
              style={{ background: color }}
              aria-pressed={style.background === color}
              aria-label={`${t('settings.subtitleBackground')} ${color}`}
              onClick={() => void updateSettings({ subtitleBackground: color })}
            />
          ))}
        </div>
      </div>

      <div className="settings__row">
        <div>
          <strong>{t('settings.subtitleOpacity')}</strong>
          <span>{t('settings.subtitleOpacityBody')}</span>
        </div>
        <div className="segmented">
          {OPACITIES.map(([label, value]) => (
            <button
              key={label}
              aria-pressed={style.backgroundOpacity === value}
              onClick={() => void updateSettings({ subtitleBackgroundOpacity: value })}
            >
              {t(`settings.opacity.${label}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings__row">
        <div>
          <strong>{t('settings.subtitleEdge')}</strong>
          <span>{t('settings.subtitleEdgeBody')}</span>
        </div>
        <div className="segmented">
          {EDGES.map((edge) => (
            <button
              key={edge}
              aria-pressed={style.edge === edge}
              onClick={() => void updateSettings({ subtitleEdge: edge })}
            >
              {t(`settings.edge.${edge}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings__row">
        <div>
          <strong>{t('settings.subtitleFont')}</strong>
          <span>{t('settings.subtitleFontBody')}</span>
        </div>
        <div className="segmented">
          {FONTS.map((font) => (
            <button
              key={font}
              aria-pressed={style.font === font}
              onClick={() => void updateSettings({ subtitleFont: font })}
            >
              {t(`settings.font.${font}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="settings__row">
        <div>
          <strong>{t('settings.subtitleReset')}</strong>
          <span>{t('settings.subtitleResetBody')}</span>
        </div>
        <button
          className="btn"
          onClick={() =>
            void updateSettings({
              subtitleScale: DEFAULT_SETTINGS.subtitleScale,
              subtitleColor: DEFAULT_SETTINGS.subtitleColor,
              subtitleBackground: DEFAULT_SETTINGS.subtitleBackground,
              subtitleBackgroundOpacity: DEFAULT_SETTINGS.subtitleBackgroundOpacity,
              subtitleEdge: DEFAULT_SETTINGS.subtitleEdge,
              subtitleFont: DEFAULT_SETTINGS.subtitleFont
            })
          }
        >
          {t('player.reset')}
        </button>
      </div>
    </section>
  )
}
