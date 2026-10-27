/**
 * Noticing that a stream has quietly stopped.
 *
 * A provider dropping a live stream is not an error anybody reports. The
 * socket stays open, ffmpeg keeps running with nothing to read, and the media
 * element sits on its last frame for as long as you let it: no `error` event,
 * no `ended`, no `stalled` worth trusting. From the user's side the picture
 * simply freezes, and the only thing that works is changing channel and
 * changing back — which is exactly what this does for them.
 *
 * The detector watches the one thing that cannot lie about it: whether the
 * element's own clock is still moving.
 */

export interface StallSample {
  /** `video.currentTime`, in seconds. */
  currentTime: number
  paused: boolean
  ended: boolean
  seeking: boolean
  /** Unix ms. Passed in rather than read here so this can be tested. */
  at: number
}

/**
 * How long the clock may stand still before the stream counts as gone.
 *
 * Long enough not to fire on an ordinary rebuffer — a provider hiccup of two
 * or three seconds is normal and recovers by itself, and reopening would cost
 * a connection and several seconds of black for no reason. Short enough that
 * nobody sits staring at a frozen goal mouth wondering whether it is their
 * internet.
 */
export const STALL_AFTER_MS = 9000

/** Smaller movements than this are rounding, not playback. */
const EPSILON = 0.05

export interface StallWatch {
  /** Feed a sample; true means the stream has stopped and should be reopened. */
  observe: (sample: StallSample) => boolean
  /** Call after reopening, so the new stream gets the full grace period. */
  reset: (at: number) => void
}

export function createStallWatch(startedAt: number): StallWatch {
  let lastTime: number | null = null
  let movedAt = startedAt

  return {
    observe(sample) {
      // A paused video is the user's decision, an ended one is the file
      // finishing, and a seeking one has not got there yet. None is a stall,
      // and all three must also push the clock forward — otherwise a video
      // paused for a minute would be declared dead the moment it resumes.
      if (sample.paused || sample.ended || sample.seeking) {
        movedAt = sample.at
        lastTime = sample.currentTime
        return false
      }

      // The first sample only establishes where the clock is. It deliberately
      // does not count as movement: a stream that reopens and never produces a
      // single frame has to be caught a grace period after the reopen, not a
      // grace period after whenever the first poll happened to land.
      if (lastTime === null) {
        lastTime = sample.currentTime
        return sample.at - movedAt >= STALL_AFTER_MS
      }

      // Any movement counts, in either direction: a seek that lands earlier is
      // still proof the element is alive.
      if (Math.abs(sample.currentTime - lastTime) > EPSILON) {
        lastTime = sample.currentTime
        movedAt = sample.at
        return false
      }

      return sample.at - movedAt >= STALL_AFTER_MS
    },

    reset(at) {
      lastTime = null
      movedAt = at
    }
  }
}
