# Columbus Food Files

C.'s restaurant notes, parsed into a searchable static site.
Live at <https://columbusfoodfiles.com>.

```
notes/source.txt  →  scripts/parse.js  →  data/entries.json  →  scripts/build.js  →  index.html
```

`notes/source.txt` is the source of truth. Everything else is generated, and
each entry's original text is carried through to the page verbatim.

## Updating one restaurant

Copy the entry in Apple Notes, then:

```bash
./scripts/update.sh
```

That pulls from the clipboard, replaces the matching entry in `source.txt` (or
inserts a new one alphabetically), re-parses and rebuilds. Review with
`git diff --stat`, then commit and push — Vercel deploys in about 12 seconds.

Matching is on the name alone, ignoring case, punctuation, `[tags]` and any
trailing `(on Sawmill)`, so a rewritten entry still finds its original.

## Replacing everything

```bash
pbpaste > notes/source.txt
node scripts/parse.js && node scripts/build.js
```

`parse.js` reports what it had to decide: entries it merged, duplicates it
folded together, non-food entries it dropped, and any place it could not read
a verdict from.

## Writing notes so they parse well

Entries are separated by a blank line, with the name on the first line.
Blank lines *inside* an entry are fine — bullet runs and section headings are
recognised as continuations.

**Verdict.** Open with it and it is picked up automatically: `Great!`,
`Excellent! Had 1/2/21`, `Good, nothing special`. Note that `Great:` is
different — that heads a list of dishes and is not read as a verdict.

**Tags.** Anything in brackets after the name overrides the parser:

```
Chili Spot [GREAT] [chinese]
```

A verdict word (`great` `good` `ok` `meh` `bad` `closed`) sets the verdict.
Anything else becomes a cuisine tag. Use this when the name gives nothing away
— cuisine is inferred from the name and opening lines only, never from the
dish list, or half the archive would come out tagged "indian" from a stray
mention of korma.

**Formatting.** Bold does not survive a paste out of Apple Notes, so the site
recovers the structure instead: lines starting with `*` or `-` render as
bullets, and a line that is just `Great:` / `Try:` / `Ok:` / `Meh:` renders as
a bold heading. Everything else renders as written.

## Fields the parser derives

`name` `verdict` (+ how confident) `cuisine` `location` `people` `visits`
`prices` `kind` `closed` — plus `notes`, which is always her text untouched.
