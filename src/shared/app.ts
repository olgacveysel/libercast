/**
 * The application's name, in one place.
 *
 * Kept out of the translation dictionaries deliberately: a product name is not
 * translated, and having it in three files is how a rename ends up half done.
 */
export const APP_NAME = 'LiberCast'

/** Used in the About box and the README. */
export const APP_TAGLINE = 'A free, open-source IPTV player'

/**
 * Where releases are published.
 *
 * Used to look for a newer build, and only when the user asks: the installer's
 * own notice says nothing leaves the machine except the requests you make, and
 * a background call to GitHub on every launch would make that untrue.
 */
export const REPOSITORY = 'olgacveysel/libercast'

export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`
