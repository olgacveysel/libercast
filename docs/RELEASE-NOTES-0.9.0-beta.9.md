LiberCast 0.9.0-beta.9 is about the application holding together — one screen
failing no longer takes the window with it — and about the two screens that
were slowest finally being quick.

## A broken screen stays one screen

Until now, if anything on a screen failed to draw, the whole window went
blank: no sidebar, no menu, nothing to click, and no hint that restarting
would help. There was nothing catching it.

Now the failure stays where it happened. You get a short explanation, a
button to try that screen again, and everything else keeps working — **and
whatever you were watching keeps playing**, because the player sits outside
that boundary deliberately.

## All sources is roughly seven times faster

The list that merges your providers into one was reworking every name,
prefix and duplicate rule each time you turned a page or typed a letter. It
is now worked out once, when a sync changes the catalogue.

On a large account — 150,000 channels across three sources — opening a page
of that list went from 480 ms to 69, the count beside it from 164 to 29, and
a search from 580 to 86. Smaller accounts were never slow enough to notice;
large ones were noticeably so.

## And the first screen stops searching the whole catalogue

"Jump back in" was reading every live channel in the database to show you
twenty, because the database had never been told how big its tables are. One
instruction fixes it: 19 ms to 0.2 on the same large account.

Both of these run when a sync finishes, so the first launch after updating
does a little work and then stays quick. **Your existing catalogue is
upgraded in place** — nothing needs re-syncing.

## Smaller things

- **The Live TV toolbar stays on Live TV.** The channel search, the sort and
  the Sync button were appearing underneath every other screen.
- **Film and series details credit the cast.** It was being fetched and
  stored and never shown — including the cast your own TMDB key paid for.
- **"Directed by" is translated.** It was shipping in English in the Turkish
  and German builds.
- **Settings has an index.** Seventeen sections and six screens of
  scrolling; the list down the side goes straight to the one you want, on
  windows wide enough to have room for it.

---

Windows, Linux AppImage and .deb, all built by CI from the tag. Unsigned on
every platform: Windows will show SmartScreen, and Linux needs the AppImage
made executable.

Checksums are in `SHA256SUMS.txt` beside the downloads.
