/**
 * Settings that match what the provider says the account allows.
 *
 * The provider reports a maximum; the app then has to decide how to spend it.
 * One connection is always reserved for playback, because a download that
 * stops the film is worse than a download that takes longer.
 */
export interface ConnectionPlan {
  /** Play live channels without identifying them first, to spend one instead of two. */
  singleConnection: boolean
  maxConcurrentDownloads: number
}

export function connectionPlan(maxConnections: number): ConnectionPlan | null {
  // Plenty of panels report nothing, or nonsense. Guessing from that would be
  // worse than leaving the user's own choice alone.
  if (!Number.isFinite(maxConnections) || maxConnections <= 0) return null

  return {
    // With a single connection there is none to spare for a probe, so a live
    // channel has to be played on assumption.
    singleConnection: maxConnections <= 1,
    // Everything above the one playback needs, and never fewer than one — a
    // download queue that can never start is not a safer default, just a
    // broken one.
    maxConcurrentDownloads: Math.max(1, Math.floor(maxConnections) - 1)
  }
}
