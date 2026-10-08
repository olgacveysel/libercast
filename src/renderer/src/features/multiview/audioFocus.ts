/**
 * Which tile the sound comes from.
 *
 * Four channels playing four soundtracks at once is unusable, so exactly one
 * tile is audible and the number keys move the sound between them — the same
 * gesture as picking a channel by number, which is what the keys do everywhere
 * else in the application.
 */

/**
 * The tile a digit selects, or null if that key is not a tile.
 *
 * Keys are 1-based because the tiles are labelled 1-based on screen. `0` is not
 * a tile: it mutes, which is the more useful thing for the key next to 1 to do
 * when you are reaching for it in a hurry.
 */
export function tileFromKey(key: string, tileCount: number): number | null {
  if (!/^[1-9]$/.test(key)) return null
  const index = Number(key) - 1
  return index < tileCount ? index : null
}

/**
 * Keeps the audio tile inside the current layout.
 *
 * Shrinking a 3x3 down to 1x2 while tile 7 held the sound would otherwise leave
 * the sound assigned to a tile that no longer exists, and nothing audible.
 */
export function clampAudioTile(index: number, tileCount: number): number {
  if (!Number.isInteger(index) || index < 0) return 0
  return index < tileCount ? index : 0
}
