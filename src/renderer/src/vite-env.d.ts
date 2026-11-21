/// <reference types="vite/client" />

/*
 * Vite's own ambient types, which this project had not needed until now.
 *
 * `import.meta.glob` is how the TMDB logo is loaded: the file is not in this
 * repository — it comes from their attribution page, unaltered — and a static
 * import of a missing file fails the build for everyone who clones. A glob
 * that matches nothing is simply empty.
 */
