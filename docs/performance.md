# Performance

Every number here was measured on this codebase — Node 24 on Windows 11, warm
cache, `react-icons@5.7.0`, 50,939 icons. Re-measure before trusting them on
other hardware; the shape of the results is what matters.

## Budget

| Moment | Cost | Notes |
|---|---:|---|
| `require dist/extension.js` | **11 ms** | 43 KB, no `ts-morph` |
| `activate()` | **~0 ms** | zero I/O |
| First `IconIndex.load()` | **~30 ms** | `manifest.json` + `names.json`, async |
| Search, warm | **10–20 ms** | inside the 120 ms debounce |
| Search, first of session | ~42 ms | JIT warmup |
| First `ts-morph` use | **~320 ms** | once, on the first insert or hover |
| First set SVG load | 7–24 ms | e.g. 4.3 MB `pi.json` parses in 24 ms |
| Data URI, cached | **0 ms** | |
| Resident after full load | ~104 MB RSS | includes the Node/tsx harness |

## Activation

`activationEvents` lists exactly four `onLanguage:*` events. Never `*`, never
`onStartupFinished`.

The `onLanguage` events are **required**, not a convenience: a hover provider
has to be registered before a hover can happen, so command-only activation would
leave hovers dead until the user invoked the picker once.

`activate()` itself constructs `IconIndex` (constructor reads nothing),
registers a hover provider and two commands, and sets one context key. No file
is opened.

## Two bundles

The single largest win in the project.

`ts-morph` embeds the whole TypeScript compiler. Bundled into `extension.js` it
cost **~320 ms of module evaluation before `activate()` even ran** — paid by
every user who merely opens a `.js` file.

A lazy `require()` inside the same bundle does **not** help. esbuild hoists ESM
module initialisation to the top of its output regardless of where the
`require()` sits.

So esbuild emits two entry points, and `src/astProject.ts` reaches the second
through a non-literal `require()` that esbuild leaves as a real runtime call:

```js
const bundled = path.join(__dirname, 'astWorker.js');
worker = require(bundled);   // not a literal -> not inlined
```

| Output | Size | Loaded |
|---|---:|---|
| `dist/extension.js` | 43 KB | at activation |
| `dist/astWorker.js` | 5.6 MB | on the first AST edit |

**Measured: 320 ms → 11 ms.**

If you add a `ts-morph` import to any file reachable from `extension.ts`, this
collapses back to 320 ms silently. `barrelFile.ts` uses
`statement.getKindName() === 'ExportDeclaration'` rather than importing
`SyntaxKind` as a value for exactly this reason. **Only `import type` from
`ts-morph` outside `astWorker.ts`.**

To verify after a change:

```bash
node esbuild.js --production && ls -la dist
# extension.js should stay well under ~100 KB
```

## Index loading

Three tiers, loaded independently:

| Tier | Size | When |
|---|---:|---|
| `manifest.json` + `names.json` | 847 KB | first search or hover |
| `svg/<set>.json` | 0.1–6 MB | first preview of an icon from that set |

Loading all 32.8 MB eagerly would be 33 MB of heap for a session that previews a
handful of icons. `JSON.parse` of a set file is synchronous and blocking, but it
happens once per set, off a user action; the largest measured is 24 ms.

Concurrent requests for the same set share one in-flight promise
(`svgSetPromises`), so a burst of previews from one set triggers a single read.

## Search

A plain `Fuse` index over all 50,939 names measured **65–160 ms per query** —
visible stutter behind a 120 ms debounce, and it also ranked worse. Replaced
with a tier scan (3–13 ms) plus Fuse over a capped 2,000-candidate fuzzy tier
(2–10 ms). Full detail and numbers in [Search](./search.md).

## Debounce and cancellation

Keystrokes schedule; they do not run. `reactIcons.searchDebounceMs` (default
120) later, one search executes.

Each scheduled search owns a `CancellationTokenSource`. A newer keystroke
cancels the older one, and the scan polls the token **every 4,096 icons** —
reading the flag 50,939 times is itself measurable, twelve reads are not.
Superseded work is abandoned mid-scan rather than completing and being thrown
away.

The QuickPick also carries a `generation` counter, so an async preview pass that
finishes after the query moved on discards its results instead of repainting
stale rows.

## Two-pass QuickPick rendering

Items appear immediately as text. SVG data URIs are attached in a second,
asynchronous pass once the relevant set JSON has loaded, and only if the
generation still matches:

```ts
quickPick.items = items;          // first paint, no I/O
if (previewsEnabled) void attachPreviews(items, current);
```

Blocking the first paint on a 4 MB file read would feel broken. Reassigning the
array is what makes VS Code re-render the rows.

`reactIcons.enableQuickPickPreviews` turns the second pass off entirely on slow
machines.

## Caching

| Cache | Key | Lifetime |
|---|---|---|
| `IconIndex.svgSets` | set id | session |
| `IconIndex.dataUriCache` | `set/name/size/colour` | session |
| `IconIndex.byName` | icon name | built once, lazily, on first hover |
| `IconHoverProvider.importCache` | `uri\|version` | until the document changes |
| `IconHoverProvider.barrelCache` | `uri\|version` | until the barrel changes |
| `astWorker` `Project` | — | session |

`IconIndex.dispose()` clears the SVG payloads and data URIs; the name arrays
stay resident because rebuilding them means re-reading 840 KB.

## Memory shape

`IconIndex` holds four parallel string arrays rather than 50,939 objects:

```ts
names[i], setIds[i], bareNames[i], fullNames[i]
```

The hot loop only touches two of them, and an array of small objects costs
noticeably more memory and GC pressure for no benefit. `IconRef` objects are
materialised only for the ≤50 results actually returned.

## Bundle and package

```
dist/extension.js     43 KB
dist/astWorker.js    5.6 MB
assets/icon-index/  33.6 MB
────────────────────────────
react-icons-inserter-0.1.0.vsix   12.06 MB, 41 files
```

The index stays as separate JSON assets rather than being inlined into the
bundle — that is what makes per-set lazy loading possible at all. JSON of path
data compresses roughly 3×, hence 33.6 MB on disk becoming a 12 MB `.vsix`.

## Regression checklist

Before merging anything that touches a hot path:

- [ ] `ls -la dist` — `extension.js` still tens of KB, not megabytes.
- [ ] `npm test` — 23 assertions, includes index load and search cancellation.
- [ ] Search still returns in tens of milliseconds for `a`, `beer`, `arrl`.
- [ ] No `import { … } from 'ts-morph'` (value import) outside `astWorker.ts`.
- [ ] `activate()` still does no I/O.
