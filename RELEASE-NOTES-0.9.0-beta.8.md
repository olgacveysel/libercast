LiberCast 0.9.0-beta.8 is mostly about what the player knows before it starts
playing, and one bug that made a guide look like a guide nobody published.

## Guides that came out empty

A guide feed writing its attributes with single quotes produced a guide with
**nothing in it**. XML permits both quote styles and feeds use both; LiberCast
read only double quotes, so every programme lost its channel and its start and
was dropped. The result was indistinguishable from a provider that publishes
no guide at all, which is what it looked like and what it was blamed on.

If your guide has been empty and your provider insists they send one, this is
worth retrying.

## Channels are identified once, not on every play

On an account that allows a single connection, LiberCast does not identify a
live channel before playing it: asking first costs a second connection, and
that is the one the provider refuses. It plays on a reasonable guess instead,
and when the guess is wrong it recovers by re-encoding.

That recovery worked and never learned. The same channel repeated it on every
open — a wasted attempt at tune-in, and a full re-encode for as long as it
played.

It now reads what ffmpeg reports about the stream it already has open and
remembers it. **The guess is made once per channel instead of once per play.**
From the second open onwards the channel starts correctly the first time, and
the stats overlay can show what the source actually is — resolution, profile,
pixel format, and whether it is interlaced — on live channels where that line
could never appear before.

## The Live TV lists resize

Category and channel names come from your provider at whatever length the
provider chose, so no fixed width suits every account. Drag either list's
right edge to size it; double-click the edge to put it back. The widths are
remembered.

## Film and series details, filled in from TMDB

Optional, and off until you add your own TMDB key in Settings → Metadata.
Plenty of providers send a title and nothing else; with a key, LiberCast fills
in the plot, year, rating, cast, runtime and backdrop that are missing.

It only ever fills gaps — anything your provider sent is kept as it sent it,
and removing the key gives the catalogue back exactly as it was. **No key is
shipped with LiberCast.** This source is public, so a key inside it is
extractable, and the account suspended over someone else's use of it would be
the maintainer's.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Under the floor

`corpus/` is new: 230 vectors across 19 suites describing what the parsers and
matchers must do, as data rather than as test code. It is how the guide bug
above was found.

---

Windows, Linux AppImage and .deb, all built by CI from the tag. Unsigned on
every platform: Windows will show SmartScreen, and Linux needs the AppImage
made executable.

Checksums are in `SHA256SUMS.txt` beside the downloads.
