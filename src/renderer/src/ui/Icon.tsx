import type { JSX, SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 16, ...rest }: Props): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest
  }
}

export function IconTv(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="m17 2-5 5-5-5" />
    </svg>
  )
}

export function IconFilm(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5" />
    </svg>
  )
}

export function IconStack(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M6 4h12M8 1h8" />
    </svg>
  )
}

export function IconStar(props: Props & { filled?: boolean }): JSX.Element {
  const { filled, ...rest } = props
  return (
    <svg {...base(rest)} fill={filled ? 'currentColor' : 'none'}>
      <path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8z" />
    </svg>
  )
}

export function IconHome(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
    </svg>
  )
}

export function IconSettings(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8a1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

export function IconSearch(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  )
}

export function IconPlus(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconRefresh(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

export function IconTrash(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" />
    </svg>
  )
}

export function IconVolume(props: Props & { muted?: boolean; quiet?: boolean }): JSX.Element {
  const { muted, quiet, ...rest } = props
  return (
    <svg {...base(rest)}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
      {/* One arc for a low level, two for a high one: the icon carries the
          level as well as the on/off state, which is what makes it readable in
          a multi-view tile bar where there is no room for a number. */}
      {muted ? (
        <path d="m16 9 5 6M21 9l-5 6" />
      ) : quiet ? (
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
      )}
    </svg>
  )
}

export function IconSidebar(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M10 4v16" />
    </svg>
  )
}

export function IconFullscreen(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  )
}

export function IconMinimize(props: Props): JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.4}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function IconMaximize(props: Props & { restore?: boolean }): JSX.Element {
  const { restore, ...rest } = props
  return (
    <svg {...base(rest)} strokeWidth={1.4}>
      {restore ? (
        <>
          <rect x="7" y="4" width="13" height="13" rx="1.5" />
          <path d="M4 8v11a1 1 0 0 0 1 1h11" />
        </>
      ) : (
        <rect x="5" y="5" width="14" height="14" rx="1.5" />
      )}
    </svg>
  )
}

export function IconClose(props: Props): JSX.Element {
  return (
    <svg {...base(props)} strokeWidth={1.4}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function IconGuide(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M9 9v12M15 9v12M8 2v3M16 2v3" />
    </svg>
  )
}

export function IconRecord(props: Props & { filled?: boolean }): JSX.Element {
  const { filled, ...rest } = props
  return (
    <svg {...base(rest)}>
      <circle cx="12" cy="12" r="7" fill={filled ? 'currentColor' : 'none'} />
    </svg>
  )
}

export function IconLibrary(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M4 4v16M9 4v16" />
      <path d="M13.5 5.2 19 4l2 15.5-5.5 1.2z" />
    </svg>
  )
}

export function IconPlay(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
    </svg>
  )
}

export function IconFolder(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

export function IconAudio(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M4 14V10M8 17V7M12 20V4M16 17V7M20 14V10" />
    </svg>
  )
}

export function IconSubtitles(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M6.5 14h4M13.5 14h4" />
    </svg>
  )
}

export function IconDownload(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 18v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  )
}

export function IconPause(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M9 4v16M15 4v16" />
    </svg>
  )
}

export function IconKeyboard(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </svg>
  )
}

export function IconGrid(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  )
}

export function IconPrevious(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M18 5v14L8 12z" fill="currentColor" />
      <path d="M6 5v14" />
    </svg>
  )
}

export function IconNext(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M6 5v14l10-7z" fill="currentColor" />
      <path d="M18 5v14" />
    </svg>
  )
}

/** Visibility. `off` draws the struck-through variant for a hidden channel. */
export function IconEye(props: Props & { off?: boolean }): JSX.Element {
  const { off, ...rest } = props
  return (
    <svg {...base(rest)}>
      {off ? (
        <>
          <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.1M6.5 7.6A17 17 0 0 0 3 12s4 6 9 6a9.7 9.7 0 0 0 4-.85" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <path d="M3 3l18 18" />
        </>
      ) : (
        <>
          <path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6z" />
          <circle cx="12" cy="12" r="2.6" />
        </>
      )}
    </svg>
  )
}

/** Playback speed — a gauge needle. */
export function IconSpeed(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M4.5 17a8.5 8.5 0 1 1 15 0" />
      <path d="m12 13.5 4-4" />
      <circle cx="12" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Picture fit — a frame with corner brackets pushing outward. */
export function IconAspect(props: Props): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M7 9v6M17 9v6" opacity="0.45" />
      <path d="M10.5 12h3M12 10.5v3" />
    </svg>
  )
}

/** A reminder set on a programme. `filled` marks one that is active. */
export function IconBell(props: Props & { filled?: boolean }): JSX.Element {
  const { filled, ...rest } = props
  return (
    <svg {...base(rest)}>
      <path
        d="M6 9a6 6 0 1 1 12 0c0 3.2.7 5 1.6 6H4.4C5.3 14 6 12.2 6 9z"
        fill={filled ? 'currentColor' : 'none'}
      />
      <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  )
}
