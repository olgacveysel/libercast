# Renderer assets

## `tmdb.svg` — supplied, not committed by us

LiberCast uses The Movie Database's API for the optional metadata lookup, and
their terms require their logo to be displayed alongside the notice. The file
is not in this repository because it is theirs: it has to come from their own
attribution page, unmodified, and copying it in from somewhere else is how a
project ends up shipping a logo that has since been retired.

Download an approved logo from:

    https://www.themoviedb.org/about/logos-attribution

Save it here as `tmdb.svg` (an SVG; a `.png` works too — the loader takes
either). Their rules, as their terms state them:

- it must be one of their approved logos
- it must not be altered in colour, aspect ratio, flipping or rotation
- it must be *less prominent* than the mark that primarily identifies this
  application, which is why the stylesheet caps its height well below the
  LiberCast mark's
- TMDB must be referred to as "TMDB" or "The Movie Database", and nothing else

`test/tmdb.test.ts` fails while the file is missing. That is deliberate: the
logo is a licence condition rather than a decoration, and a condition nobody
is reminded of is a condition that gets forgotten.
