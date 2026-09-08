# Search

`IconIndex.search(query, limit, token)` in `src/iconIndex.ts`.

## The problem with "just use Fuse"

The brief called for `fuse.js`. Measured against the real index on this machine
(Node 24, 50,939 names, warm):

```
buildIndex          35 ms      (once)
search "beer"       92 ms
search "arrl"       69 ms
search "arrow-left" 158 ms
search "home"       66 ms
```

65–160 ms per query, synchronous, on the extension host's main thread, behind a
120 ms debounce. That is visible stutter on every keystroke that lands.

Ranking was also wrong for this data. `beer` returned:

```
CiBeerMugFull, FaBeer, FaBeerMugEmpty, IoIosBeer, IoMdBeer
```

`FaBeer` — an exact match on the bare name — placed second, behind a longer
name. Fuse scores by string distance and has no notion that "the query is
exactly this icon's name" should win.

## What it does instead

Two stages. The first is a hand-written scan; the second is Fuse, used only
where fuzziness is actually needed.

### Stage 1 — tier classification

One pass over `bareNames` and `fullNames`, sorting each icon into a bucket:

| Tier | Condition | Example: query `home` |
|---|---|---|
| exact | `bare === q` or `full === q` | `FaHome`, `CiHome` |
| prefix | `bare.startsWith(q)` or `full.startsWith(q)` | `FaHomeUser` |
| substring | `bare.includes(q)` or `full.includes(q)` | `MdOutlineHomeWork` |
| fuzzy | `isSubsequence(full, q)`, capped at 2,000 | `HiOutlineHandRaised` |

Both the bare and the full name are tested so `beer` and a pasted `FaBeer` both
land. The query is normalised the same way the names were — lowercased, all
non-alphanumerics stripped — so `arrow-left`, `arrow left` and `ArrowLeft`
are one query.

Exact/prefix/substring are sorted by **name length, then alphabetically**. Short
names are the ones you meant; this is what puts `FaBeer` above `CiBeerMugFull`.
Nothing re-shuffles them afterwards.

### Stage 2 — Fuse on the leftovers

If the first three tiers already fill `limit`, Fuse is never constructed. When
they do not, a fresh `Fuse` instance ranks the fuzzy tier only:

```ts
new Fuse(candidates, {
  keys: ['n'],
  threshold: 0.45,
  ignoreLocation: true,
  minMatchCharLength: Math.min(2, normalized.length),
})
```

`ignoreLocation` matters — icon names are compounds, and a match at position 12
of `TbBrandFacebook` is as good as one at position 2. The candidate set is
capped at `FUZZY_CANDIDATE_CAP = 2000`, which bounds Fuse's cost regardless of
how permissive the query is.

Building a Fuse index over ≤2,000 items is sub-millisecond, so it is built per
query rather than cached. Caching it would mean invalidating on every keystroke
anyway.

### Measured

```
query          total
"beer"          42 ms      1764 matches
"arrl"          20 ms      2000 matches (fuzzy cap hit)
"arrow left"    13 ms       479 matches
"home"          10 ms       613 matches
"FaBeer"        10 ms        45 matches
"xyzzy"         13 ms         0 matches
""               0 ms     50939 (sampled, not scanned)
```

The first query in a session is the slowest (JIT warmup). Everything after is
10–20 ms — inside the debounce window, invisible to the user.

## Cancellation

Each scheduled search owns a `CancellationTokenSource`. A newer keystroke
cancels the older one, and the scan loop polls:

```ts
if ((i & 0xfff) === 0 && token?.isCancellationRequested) {
  return { icons: [], total: 0, cancelled: true };
}
```

Every 4,096 icons, not every icon. Reading the flag 50,939 times is itself
measurable; twelve reads are not. A cancelled scan returns `cancelled: true` and
the caller discards it without touching the UI.

## Empty query

Scanning 50,939 names to match everything is pointless. An empty query returns
the first `limit` icons directly and reports `total` as the full count.

## Paging

`search` returns `total` alongside the capped `icons`. When `total` exceeds what
was returned, `quickPick.ts` appends a sentinel row:

```
$(ellipsis) Show more        showing 50 of 613 matches
```

Selecting it multiplies `limit` by 4 and re-runs the same query. Typing anything
resets `limit` to the configured `reactIcons.maxResults`.

## Extending it

**Adding keyword/tag search.** `react-icons` ships no tags. Baking synonyms into
`names.json` would inflate the always-loaded tier; a separate lazily-loaded
`tags.json` keyed by icon name, consulted only in the fuzzy tier, would not.

**Changing tier order.** The tiers are concatenated in
`[...exact, ...prefix, ...substring]` order and truncated to `limit`. Reordering
is a one-line change, but re-sorting the combined array by anything other than
tier will undo the "exact match wins" property that the whole design exists for.

**Raising `FUZZY_CANDIDATE_CAP`.** It bounds Fuse's input, and Fuse is
superlinear in practice. 2,000 candidates cost 2–10 ms; measure before raising
it, and remember the cost lands inside the debounce window.
