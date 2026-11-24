# The LiberCast corpus

What LiberCast's parsers and matchers must *do*, written as data rather than
as TypeScript.

There is nothing to install and nothing to import. Every case is a function
name, a list of arguments and the answer, in JSON. An implementation in any
language can read these files, call its own functions, and find out whether it
agrees.

## Why it exists

LiberCast's parsers are the part most likely to be rewritten rather than
shared. None of them compiles on Android: they use Node's crypto, its streams
and its zlib, and an Android player would implement them again in Kotlin. A
rewrite checked only against its own new tests is a rewrite that quietly
disagrees with the original about the playlists people actually have — and the
disagreements that matter are not the obvious ones. They are a channel id
derived from a slightly different string, so every favourite moves; a time
zone applied in the wrong direction, so the guide is an hour out; a quote
style nobody thought about, so the guide is empty.

It pays for itself before any of that. These cases used to live inside test
files as assertions about particular functions, so changing a signature meant
rewriting the evidence along with the code — which is how a refactor loses the
cases that were hard-won. Here the evidence is data. A refactor updates one
adapter.

## Running it

In this repository the corpus runs as part of `npm test`, from
`test/corpus.test.ts`. That file is both the adapter — a map from the names
used here to the real functions — and the referee. It also fails when a vector
file is not in the manifest, or an adapter has no suite, because a vector file
nobody runs is worse than no vector file: it reads like coverage.

From another language, the shape is the same:

1. Read `manifest.json`. It lists each suite's file and the function that
   suite describes.
2. For each case, call that function with `args` spread as positional
   arguments.
3. Compare the result to `expect`, **by value**: object key order must not
   matter, and numbers that are not whole are compared to the number of
   decimal places in `rounding` (currently 4).
4. A case whose `expect` is `{"threw": "<message>"}` must raise, and the
   message must match.

Comparing by value with sorted keys is not a detail. Another language's map
will not share JavaScript's insertion order, and an implementation that only
passes because its fields happen to come out in the same sequence has not
been checked at all.

## What is in a case

```json
{
  "name": "a regional variant is not the same channel",
  "why": "This pair scores high enough to be switched to silently.",
  "args": ["Alto Sports 2", "Alto Sports 2 Turkey"],
  "expect": false
}
```

`name` is unique within its suite and is what a failure prints. `why` is
optional and is there for the cases whose answer looks wrong until you know
the story — most of them are bugs this project actually shipped, and the note
is what stops someone "fixing" the behaviour back to broken.

Each file also carries `notes`: the rules that cannot be read off the data.
Read those before implementing the function. They are where the id derivation,
the time-zone decisions and the deliberate boundaries are written down.

## The suites

| function | what it must do |
| --- | --- |
| `m3u.parse` | A playlist to a catalogue of categories and channels |
| `xmltv.time` | An XMLTV timestamp to Unix milliseconds |
| `xmltv.entities` | XML entity decoding, as the guide needs it |
| `xmltv.programme` | One `<programme>` block to a guide entry |
| `xmltv.channel` | One `<channel>` block to a guide channel |
| `names.fold` | The folded form used for search, filtering and the parental check |
| `names.normalize` | A channel name to its identifying words |
| `names.same` | Whether two names are the same channel beyond doubt |
| `names.similarity` | How alike two channel names are, 0 to 1 |
| `names.best` | Choosing a guide channel, or refusing to |
| `catchup.window` | How far back an archive reaches |
| `catchup.replay` | Whether a programme can be replayed now |
| `catchup.start` | The start stamp a panel's archive URL carries |
| `failover.rank` | Which channel from another provider may be played when this one fails |
| `xtream.fields` | The coercions that turn a panel's JSON into catalogue fields |

## Things worth knowing before you implement any of it

**Channel ids are a compatibility surface.** An M3U playlist has no stable
identifier, so one is derived from the stream URL — the first 16 hex
characters of its SHA-1. Favourites, hidden channels, recordings and resume
positions are all stored against that id. Deriving it differently is not a
cosmetic difference; it is every one of those rows pointing at nothing.

**Scores are arithmetic, and arithmetic is where languages drift.** The
similarity score is compared to four places. If your implementation disagrees
in the fourth place, that is a real difference worth finding, not a rounding
artefact to widen the tolerance for.

**A refusal is a result.** `names.best` returning null when two candidates are
too close, and `xmltv.programme` returning null for a programme with no title,
are the behaviour — not gaps in the cases. A guide that is confidently wrong
is harder to diagnose than one that is empty, because nobody thinks to doubt
it.

**Boundaries are decided, not incidental.** A programme that ends at exactly
the current instant is replayable and is not on air. The two functions use `>`
and `>=` in matching places so that no programme is ever both, and changing
either one breaks that.

## Adding a case

Write the expectation by hand, from what the function *should* do, and then
run it. If it fails, one of the two is wrong and you have learned something
either way — that is the entire value, and it is lost if expectations are
generated from the current output and pasted back in. Generating them records
what the code does today, bugs included, and dresses it up as a specification.

Every case in this corpus was written before it was run. Five failed on the
first run. Three were arithmetic mistakes in the expectation; one was a
boundary that turned out to be right for a reason worth writing down; and one
was a real bug — `xmltv.programme` read only double-quoted attributes, so a
feed using single quotes produced a guide with nothing in it.

Some cases record a limitation rather than endorse it, and say so in `why`.
`names.fold` leaves German ß alone, so `Straße` and `Strasse` do not fold
alike; `xtream.fields` does not look past an empty first image. Both are
pinned because a second implementation differing there would disagree about
what is hidden and what has artwork — the point is that the two agree, not
that either is ideal.
