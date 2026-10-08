/**
 * Which subtitle track a video element is showing.
 *
 * A media element's TextTracks cannot be removed once added, only switched off,
 * so showing a different subtitle means disabling the others by hand. That is
 * where this went wrong: a blanket "disable everything" ran from a React effect
 * that did not own the track it was disabling, and switched off the stream's
 * own subtitles a moment after they were attached — so embedded subtitles never
 * appeared at all. Every operation here therefore names what to keep.
 */

/** The part of HTMLVideoElement this needs, so it can be tested without a DOM. */
export interface TrackHost {
  textTracks: { length: number; [index: number]: TrackLike }
}

export interface TrackLike {
  mode: string
  label?: string
}

/**
 * Switches off every track except the one passed.
 *
 * `keep` is required rather than optional: an accidental "disable all" is the
 * exact bug this module exists to prevent, so silencing the stream's subtitles
 * has to be spelled out as `disableOthers(element, null)`.
 */
export function disableOthers(host: TrackHost, keep: TrackLike | null): void {
  for (let i = 0; i < host.textTracks.length; i++) {
    const track = host.textTracks[i]
    if (!track || track === keep) continue
    track.mode = 'disabled'
  }
}

/**
 * Re-asserts a track as visible.
 *
 * Chromium drops a track back to `disabled` when the element's source changes,
 * which happens on every reopen — a seek, a track change, a retry. Without
 * this, subtitles work until the first seek and then quietly stop.
 */
export function ensureShowing(track: TrackLike | null): void {
  if (track && track.mode !== 'showing') track.mode = 'showing'
}

/** True when at least one track is actually being displayed. */
export function anyShowing(host: TrackHost): boolean {
  for (let i = 0; i < host.textTracks.length; i++) {
    if (host.textTracks[i]?.mode === 'showing') return true
  }
  return false
}
