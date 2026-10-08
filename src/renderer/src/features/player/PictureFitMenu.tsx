import type { JSX } from 'react'
import { VIDEO_FITS, type VideoFit } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { IconAspect } from '@renderer/ui/Icon'
import { useT, type TranslationKey } from '@renderer/i18n'
import { PickerMenu } from '@renderer/ui/PickerMenu'
import { clampZoom } from './videoFit'

/**
 * Picture fit and zoom.
 *
 * Both are stored settings rather than per-player state: a provider that sends
 * everything pillarboxed does so on every channel, and having to correct it
 * again on each one would make the control useless. It reads the store
 * directly so either player can drop it into its transport bar unchanged.
 */
/**
 * The mode names live in the shared constant, but the constant is loaded once
 * at module scope and cannot hold translated text — so it supplies the values
 * and these map them to keys.
 */
function fitKey(fit: VideoFit): TranslationKey {
  switch (fit) {
    case 'fill':
      return 'fit.fill'
    case 'stretch':
      return 'fit.stretch'
    case '16:9':
      return 'fit.16by9'
    case '4:3':
      return 'fit.4by3'
    default:
      return 'fit.fit'
  }
}

function hintKey(fit: VideoFit): TranslationKey {
  switch (fit) {
    case 'fill':
      return 'fit.fillHint'
    case 'stretch':
      return 'fit.stretchHint'
    case '16:9':
      return 'fit.16by9Hint'
    case '4:3':
      return 'fit.4by3Hint'
    default:
      return 'fit.fitHint'
  }
}

export function PictureFitMenu(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const t = useT()

  const zoom = clampZoom(settings.videoZoom)
  const label = t(fitKey(settings.videoFit))

  return (
    <PickerMenu<VideoFit>
      label={t('player.picture')}
      icon={<IconAspect size={16} />}
      current={zoom > 1 ? `${label} ${Math.round(zoom * 100)}%` : label}
      options={VIDEO_FITS.map((fit) => ({
        value: fit.value,
        label: t(fitKey(fit.value)),
        hint: t(hintKey(fit.value))
      }))}
      selected={settings.videoFit}
      onSelect={(value) => void updateSettings({ videoFit: value })}
      title={`${t('player.picture')}: ${label} (Z)`}
      footer={
        <div className="trackmenu__offset">
          <strong>{t('player.zoom')}</strong>
          <input
            type="range"
            min={1}
            max={1.6}
            step={0.02}
            value={zoom}
            onChange={(event) => void updateSettings({ videoZoom: Number(event.target.value) })}
            aria-label={t('player.zoom')}
          />
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="btn btn--ghost"
            onClick={() => void updateSettings({ videoZoom: 1 })}
            disabled={zoom === 1}
          >
            {t('player.reset')}
          </button>
        </div>
      }
    />
  )
}
