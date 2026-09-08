# React Icons Inserter

Search, preview and insert any of the **50,939 icons** from
[`react-icons`](https://react-icons.github.io/react-icons/) straight into your
React files — with imports routed through a single, centralised barrel file
instead of scattered `react-icons/*` imports.

![The grid picker, searching for "arrow"](https://raw.githubusercontent.com/iftekharweb/react-icons-inserter/main/media/screenshot-grid.png)

---

## Documentation

Deeper docs live in [`docs/`](./docs/):

| Page | Covers |
|---|---|
| [Architecture](./docs/architecture.md) | Module graph, activation lifecycle, the data flow of one insert and one hover. |
| [Icon index](./docs/icon-index.md) | The generator, the on-disk JSON format, lazy per-set loading. |
| [Search](./docs/search.md) | The two-stage ranking algorithm and the Fuse benchmarks behind it. |
| [Pickers](./docs/pickers.md) | Grid vs list, the webview message protocol, keyboard map. |
| [Barrel file](./docs/barrel-file.md) | Location, language detection, sorting, collision aliasing, edge cases. |
| [Imports & edits](./docs/imports-and-edits.md) | ts-morph usage, the single WorkspaceEdit, atomicity and undo. |
| [Hover](./docs/hover.md) | The import-verification chain and markdown rendering. |
| [Performance](./docs/performance.md) | Every measurement, the budget, and the regression checklist. |
| [Configuration](./docs/configuration.md) | Full settings, commands, keybindings, context keys. |
| [Development](./docs/development.md) | Setup, build, F5, conventions, release checklist. |
| [Testing](./docs/testing.md) | How the suite runs without an Extension Host. |
| [Troubleshooting](./docs/troubleshooting.md) | Symptom-first fixes. |
| [Licensing](./docs/licensing.md) | What you must check before publishing. |

---

## Features

### Searchable icon picker

`Ctrl+Alt+I` (`Cmd+Alt+I` on macOS), right-click → **Insert React Icon**, or the
Command Palette.

Two styles, set by `reactIcons.pickerStyle`:

- **Grid** (default) — a panel of rendered icons at 16–96 px with a live size
  slider. For browsing by shape. Fully keyboard-driven: arrows move, `Enter`
  inserts, `Escape` closes, typing anything jumps back to the search box.
- **List** — the native QuickPick. Faster when you already know the name.

The slider reflows the grid live, so you can trade density for legibility:

![The grid picker at 64 px, searching for "home"](https://raw.githubusercontent.com/iftekharweb/react-icons-inserter/main/media/screenshot-grid-large.png)


Type a fuzzy query either way:

```
beer          -> BiBeer, FaBeer, IoBeer, LuBeer, TbBeer …
arrow left    -> BsArrowLeft, FaArrowLeft, FiArrowLeft …
arrl          -> FaArrowAltCircleLeft, FaArrowCircleLeft …
FaBeer        -> FaBeer   (paste a full name and it ranks first)
```

Results show the icon name, its set (Font Awesome 5, Feather, Material Design,
…) and a rendered SVG preview — 120 at a time in the grid, 50 in the list, with
**Load more** to widen.

The right-click entry appears only in files that actually look like React:
`.jsx`/`.tsx` always, `.js`/`.ts` only when the file imports React or contains
JSX.

### Centralised barrel file — no direct `react-icons` imports

Icons are **never** imported from `react-icons/*` in your components. The
extension maintains one barrel at `<workspace>/icons/react-icons.{ts,js}`:

```ts
// icons/react-icons.ts
export { FaBeer } from 'react-icons/fa';
export { MdHome } from 'react-icons/md';
```

and your component imports from it by relative path, however deeply nested:

```tsx
// src/features/checkout/Widget.tsx
import { FaBeer } from '../../../icons/react-icons';

export const Widget = () => <FaBeer />;
```

Inserting a second icon **merges** into that import rather than adding a line:

```tsx
import { FaBeer, MdHome } from '../../../icons/react-icons';
```

All of this is AST work via [`ts-morph`](https://ts-morph.com), not regex — so
multi-line imports, aliases, default imports, `"use client"` prologues and
double-quote codebases all survive intact.

**Language detection.** On first use the barrel is created as `.ts` when the
workspace has a `tsconfig.json` or the file being edited is `.ts`/`.tsx`,
otherwise `.js`. An existing barrel always wins — the other variant is never
created. If both exist, `.ts` is used and you get a warning about the ambiguity.

**Name collisions are kept, not dropped.** `react-icons` has 1,431 names shared
across sets (`fa`/`fa6`, `io`/`io5`, `hi`/`hi2`). If you already re-export
`FaBeer` from `fa` and then pick `FaBeer` from `fa6`, both are kept and the new
one is aliased:

```ts
export { FaBeer } from 'react-icons/fa';
export { FaBeer as FaBeerFa6 } from 'react-icons/fa6';
```

A notification tells you it happened so you can rename either one.

**Running the picker inside the barrel file itself** just adds the re-export and
skips the import step — a barrel does not import from itself.

### Hover previews

Hovering an icon shows a large rendered preview, its set, its `react-icons`
source module, the barrel path it came from, and a **Change icon** link that
reopens the picker to swap it in place (props on the element are preserved).

The hover deliberately does *not* pattern-match capitalised words. It fires only
when the identifier is a named import in that file, **and** that import resolves
on disk to the barrel, **and** the barrel re-exports it from `react-icons/*`.
A component of your own called `Home` or `Menu` will never trigger it. Aliased
icons (`FaBeerFa6`) resolve back to the real icon.

### `react-icons` dependency check

The extension needs nothing installed — the SVG data is baked in. The generated
barrel does, since it re-exports from `react-icons` at runtime. If the package
is missing from your `package.json`, you get a one-time prompt offering to run
`npm install react-icons`.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `reactIcons.barrelDirectory` | `icons` | Workspace-relative barrel folder. |
| `reactIcons.barrelFileName` | `react-icons` | Barrel base name, no extension. |
| `reactIcons.language` | `auto` | `auto` / `ts` / `js` for a newly created barrel. |
| `reactIcons.pickerStyle` | `grid` | `grid` (webview panel) or `list` (QuickPick). |
| `reactIcons.gridIconSize` | `32` | Icon size in px for the grid picker, 16–96. |
| `reactIcons.maxResults` | `50` | Results per page in the list picker. |
| `reactIcons.searchDebounceMs` | `120` | Debounce before a search runs. |
| `reactIcons.enableQuickPickPreviews` | `true` | SVG previews in the picker. |
| `reactIcons.enableHoverPreview` | `true` | Hover previews. |
| `reactIcons.checkReactIconsDependency` | `true` | Warn when `react-icons` is missing. |
| `reactIcons.sortBarrelExports` | `set` | `set` (grouped by source) or `name`. |

Keybinding `reactIcons.insert` defaults to `Ctrl+Alt+I` / `Cmd+Alt+I` and is
rebindable in **Keyboard Shortcuts**.

---

## Developing / testing locally

```bash
npm install
npm run generate-index    # builds assets/icon-index/ from node_modules/react-icons (~10 s)
npm run build             # bundles dist/extension.js with esbuild
```

Then press **F5** in VS Code. That launches an **Extension Development Host**
window with the extension loaded (`.vscode/launch.json` runs the build first).
In that window:

1. Open any folder with a React project — or just create `App.tsx` with
   `export const App = () => <div />;`
2. Put the caret inside the JSX and press `Ctrl+Alt+I`.
3. Type `beer`, pick `FaBeer`.
4. Check that `icons/react-icons.ts` was created, that `App.tsx` gained
   `import { FaBeer } from './icons/react-icons';` and `<FaBeer />`.
5. Hover `FaBeer` to see the preview.

`npm run watch` rebuilds on save; use **Developer: Reload Window** in the host
to pick up changes. `npm run compile` type-checks without emitting.

### Tests

```bash
npm test
```

23 assertions covering the barrel file (creation, sorting, dedupe, cross-set
collisions, hand-edited barrels), relative specifier resolution, import merging
(directives, quote style, extensions, no corruption), the full insert flow, the
hover's import verification, and the index's loading/search/cancellation.

They run in plain Node, not an Extension Host: `test/vscodeStub.ts` provides an
in-memory `vscode` module and a fake filesystem, and captured `WorkspaceEdit`
operations are replayed onto it — so assertions are about the exact text the
extension would write. Fast enough to run on every change, and it caught a real
bug during development (reading `ts-morph` node offsets *after* mutating the
AST, which silently ate part of the file on the second insert).

Package a `.vsix` with `npx vsce package`.

> The index generator is a **development-time** script. `react`, `react-dom` and
> `react-icons` are devDependencies used only to render the SVG data; none of
> them ship in the extension or are required in the user's project for the
> picker and hover to work.

---

## Performance trade-offs

Each of these was a real decision, not a default:

**Activation is scoped to four languages.** `activationEvents` lists
`onLanguage:javascript|javascriptreact|typescript|typescriptreact` — never `*`,
never `onStartupFinished`. The `onLanguage` events are not optional: a hover
provider must be registered before a hover happens, so command-only activation
would leave hovers dead until you invoked the picker once. `activate()` itself
performs **zero I/O**.

**Three-tier index loading.** The generator emits `manifest.json` (4 KB),
`names.json` (840 KB) and 31 per-set `svg/*.json` files (32.8 MB total). Only
the first two are loaded, and only lazily on the first search or hover (~30 ms).
A set's SVG payload is read the first time an icon from that set is previewed
(4.3 MB `pi.json` parses in ~24 ms) and is then cached for the session. Loading
everything eagerly would cost 33 MB of heap for a feature most sessions use for
a handful of icons.

**Search is deliberately not "just Fuse".** Benchmarked on this index, a
`fuse.js` search across all 50,939 names costs **65–160 ms per query** — visibly
janky behind a 120 ms debounce, and it runs on the extension host's main thread.
Instead:

- a tight typed loop classifies names into exact / prefix / substring /
  subsequence tiers in **3–13 ms**, with no index to build;
- `fuse.js` then ranks *only* the subsequence tier, capped at 2,000 candidates,
  costing **2–10 ms**.

This is also better ranking: pure Fuse scoring puts `CiBeerMugFull` above
`FaBeer` for the query `beer`. Exact and substring hits keep deterministic
shortest-name-first order and are never re-shuffled.

**Debounce plus real cancellation.** Keystrokes schedule rather than run.
Each scheduled search owns a `CancellationTokenSource`; a newer keystroke
cancels the older one and the scan loop polls that token every 4,096 icons
(polling it 51,000 times is itself measurable), so superseded work is abandoned
mid-flight instead of completing and being discarded.

**Two-pass QuickPick rendering.** Items appear immediately as text; SVG data
URIs are attached in a second pass once the set JSON has loaded, and are dropped
if the query has moved on. Blocking the first paint on a 4 MB file read would
feel broken.

**Caching.** Rendered data URIs are memoised per `(icon, size, colour)`. Hover
AST parses are memoised per `(document uri, document version)`, so re-hovering
an unedited file parses nothing.

**One shared `ts-morph` Project.** Constructing a `Project` allocates a full
TypeScript language service. A single in-memory instance is created on first AST
edit and reused; source files are added and removed per operation so nothing
accumulates. Text always comes from `TextDocument` (so unsaved edits count) and
goes back as a `WorkspaceEdit`.

**Minimal text edits, not whole-file rewrites.** The active file receives an
offset-precise edit — either a rewrite of just the existing import declaration
or a single inserted line — so caret, selection and folding state survive. Only
the barrel file gets a whole-file replacement, because it is regenerated sorted.

**Two bundles, so ts-morph never costs you startup.** `ts-morph` embeds the
whole TypeScript compiler. Bundled into `extension.js` it added **~320 ms of
module evaluation before `activate()` even ran** — paid by every user who merely
opens a `.js` file. A lazy `require()` inside the same bundle does not help:
esbuild hoists ESM module init to the top of its output regardless. So esbuild
emits two bundles and `src/astProject.ts` loads the second through a non-literal
`require()` that esbuild leaves as a real runtime call:

| Output | Size | Loaded |
|---|---:|---|
| `dist/extension.js` | 43 KB | at activation |
| `dist/astWorker.js` | 5.6 MB | on the first AST edit |

Measured: **320 ms → 11 ms** to require the extension, `activate()` at ~0 ms.
Regex-based import editing would have avoided ts-morph entirely and was
explicitly rejected as unreliable on multi-line imports, aliases and directives.

The icon index stays as separate static JSON assets rather than being inlined,
which is what makes lazy per-set loading possible at all. The packaged `.vsix`
is ~12 MB (33 MB of JSON compresses well).

### Known limitation: cross-file undo

Every write — JSX, the active file's import, the barrel's re-export, even the
barrel's creation — goes into **one** `vscode.WorkspaceEdit` applied in a single
`applyEdit()` call, so the operation lands atomically.

Undo is different, and worth being blunt about: **VS Code keeps a separate undo
stack per document.** `Ctrl+Z` in your component undoes the JSX and the import
together (same document, same edit) but does **not** roll back the barrel file —
that needs its own undo in that file. No API exists to join undo stacks across
documents. A stale barrel entry is harmless (an unused re-export), so the
extension does not try to paper over it.

Other limits worth knowing:

- Non-relative import specifiers (`@/icons/react-icons` via tsconfig `paths`)
  are only recognised when they match the string the extension itself would
  generate. Resolving `paths` mappings is out of scope; guessing wrong would
  produce a duplicate import.
- **Change icon** swaps the identifier and adds the new import, but leaves the
  previous icon's now-possibly-unused import alone — proving no other reference
  exists is the language server's job.
- If the barrel file contains anything other than re-exports, new entries are
  appended in place instead of the file being regenerated sorted, so your hand
  edits are never reordered or lost.

---

## Attribution

This extension bundles pre-rendered SVG data for **50,939 icons across 31 sets**,
sourced from [`react-icons`](https://react-icons.github.io/react-icons/) (MIT).
The artwork belongs to its original authors and is redistributed here under each
set's own license. Icon path data is unmodified; only the wrapper `<svg>`
attributes (`viewBox`, `width`, `height`, `fill`, `stroke`) are set at render
time.

Sets with terms beyond a plain permissive grant:

- **Font Awesome 5 & 6** — <https://fontawesome.com> — icons licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 3,669 icons.
- **Circum Icons** — <https://circumicons.com> — licensed under
  [MPL-2.0](https://github.com/Klarr-Agency/Circum-Icons/blob/main/LICENSE).
  288 icons.

The remaining sets are MIT or equivalent. Per-set names, counts, licenses and
links are in **[ICON-LICENSES.md](./ICON-LICENSES.md)**.

The extension's own source code is MIT ([LICENSE](./LICENSE)). The MIT license
covers the code only — not the bundled artwork.

Maintainers: see [docs/licensing.md](./docs/licensing.md) before adding,
removing, or upgrading an icon set.

---

## Not in v1

Mentioned so you know they were considered, not overlooked:

- icon colour/size customisation UI
- non-React frameworks (Vue, Svelte)
- multi-icon batch insert
- telemetry/analytics

---

## Project layout

```
src/extension.ts        activation, commands, context key, hover registration
src/iconIndex.ts        index loading, tiered search, lazy SVG + data URI cache
src/gridPicker.ts       grid picker webview: panel, protocol, per-page SVG
src/quickPick.ts        list picker: debounce, cancellation, two-pass previews
media/picker.{css,js}   grid webview presentation and input
src/barrelFile.ts       barrel location/creation, re-exports, collisions, paths
src/importManager.ts    import merging + the single WorkspaceEdit
src/hoverProvider.ts    import-verified hover previews
src/astProject.ts       deferred loader for the AST layer (no ts-morph at load)
src/astWorker.ts        the ts-morph layer -- its own bundle, loaded on demand
src/dependencyCheck.ts  one-time react-icons dependency prompt
scripts/generate-icon-index.ts   build-time index generator
test/run.ts             test suite (npm test)
test/vscodeStub.ts      in-memory `vscode` + fake filesystem for the tests
esbuild.js              two-entry bundling config
assets/icon-index/      generated static JSON (regenerate, do not hand edit)
```

Three files go beyond the original spec's list, each for a stated reason:
`astProject.ts` + `astWorker.ts` are the deferred-loading split described above
(one file could not both be the lazy loader and the lazily loaded module), and
`dependencyCheck.ts` holds the dependency prompt, which neither `importManager`
nor `barrelFile` could own without creating an import cycle.
