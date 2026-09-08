# Icon index

The extension does not read the user's `node_modules`. It ships its own index,
generated at development time from `react-icons` and bundled as static JSON.

## Why a generator exists

`react-icons` ships no searchable index. Every subset is an auto-generated
CommonJS module of factories:

```js
// node_modules/react-icons/fa/index.js
var GenIcon = require('../lib').GenIcon
module.exports.FaBeer = function FaBeer (props) {
  return GenIcon({"tag":"svg","attr":{"viewBox":"0 0 448 512"},"child":[...]})(props)
}
```

Three ways to get the artwork out, and why we picked the third:

| Approach | Verdict |
|---|---|
| Regex the `GenIcon({...})` literal | Brittle. Escaped quotes, nested `child` arrays, per-set attribute quirks. |
| Monkey-patch `GenIcon` to capture the tree | Tried it. The patch does not take: `fa/index.js` resolves `../lib` through the package's own `exports` map, so the module object we patched is not the one it captured. |
| **Render each icon with `react-dom/server`** | **Chosen.** Produces exactly the markup the user's app would render, so there is nothing to get subtly wrong. |

`scripts/generate-icon-index.ts` requires each set's `index.js` directly (the
package `exports` map does not expose `lib/iconsManifest.js`, so the manifest is
read by file path), calls `renderToStaticMarkup` on every export, and splits the
resulting `<svg …>…</svg>` into a `viewBox` and an inner body.

`react`, `react-dom` and `react-icons` are **devDependencies**. None of them ship
in the extension, and none are required in the user's project for the picker or
hover to work.

## Running it

```bash
npm run generate-index
```

Roughly 10 s. It wipes and rewrites `assets/icon-index/` — never hand-edit that
directory. `vscode:prepublish` runs it before every package so a fresh clone
cannot ship an empty or stale index.

Current output, against `react-icons@5.7.0`:

```
react-icons     5.7.0
sets            31
icons           50939
names.json      840 KB (loaded at activation)
svg/*.json      32.8 MB (lazy, per set)
took            10.2s
```

`assets/icon-index/` is gitignored. It is a build artifact.

## On-disk format

```
assets/icon-index/
  manifest.json         7 KB     set metadata, counts, licenses
  names.json          840 KB     { setId: [iconName, ...] }
  svg/<setId>.json    0.1–6 MB   { iconName: [viewBox, innerSvg] }
```

**`manifest.json`**

```json
{
  "indexVersion": 1,
  "generatedAt": "…",
  "reactIconsVersion": "5.7.0",
  "total": 50939,
  "sets": [
    { "id": "fa", "name": "Font Awesome 5", "projectUrl": "…",
      "license": "CC BY 4.0 License", "licenseUrl": "…", "count": 1611 }
  ]
}
```

The license fields come straight from `react-icons`' own manifest and are what
[`ICON-LICENSES.md`](../ICON-LICENSES.md) is generated from.

**`names.json`** — grouped by set, which is both the smallest encoding and the
form the loader wants:

```json
{ "fa": ["Fa500Px", "FaAd", "FaAddressBook", …], "md": [ … ] }
```

**`svg/<setId>.json`** — the outer `<svg>` wrapper is stripped so previews can
be re-wrapped at any size and colour:

```json
{ "FaBeer": ["0 0 448 512", "<path d=\"M368 96h-48V56c0-13.255…\"></path>"] }
```

## Why three files, not one

Splitting is the whole reason lazy loading is possible.

| Tier | Size | When it loads |
|---|---:|---|
| `manifest.json` + `names.json` | 847 KB | First search or hover — never at activation. |
| `svg/<set>.json` | 0.1–6 MB | First time an icon **from that set** is previewed. |

A single combined file would be 33 MB of heap for a session that previews a
handful of icons. Inlining the JSON into the JS bundle would make it
unavoidable, which is why the index stays as separate assets even though
`esbuild` could happily embed it.

## Loading and caching (`src/iconIndex.ts`)

`IconIndex` holds four parallel arrays, one entry per icon:

```ts
names[i]      // "FaBeer"        — the export symbol
setIds[i]     // "fa"
bareNames[i]  // "beer"          — prefix stripped, lowercased, alnum only
fullNames[i]  // "fabeer"        — lowercased, alnum only
```

Flat string arrays rather than 50,939 small objects: the hot search loop only
ever touches `bareNames` and `fullNames`, and the object-per-icon shape costs
noticeably more memory and GC pressure for no gain. `IconRef` objects are
materialised only for the ≤50 results actually returned.

The set prefix (`Fa`, `Md`, and note that `io5` still emits `Io*`) is derived
from the set id and verified against a sample name, rather than hardcoding a
31-entry table:

```ts
prefixLengthFor('io5', 'IoAdd')  // tries "Io5", then "Io" -> 2
```

Three caches, all session-scoped:

| Cache | Key | Populated by |
|---|---|---|
| `svgSets` | set id | `loadSvgSet()`, once per set |
| `svgSetPromises` | set id | in-flight loads, so concurrent callers share one read |
| `dataUriCache` | `set/name/size/colour` | `getDataUri()` |
| `byName` | icon name | built once, lazily, only when the hover first needs it |

`dispose()` clears the SVG payloads and data URIs; the name arrays stay.

## Rendering a preview

```ts
getSvgMarkup(icon, size, color)
// <svg xmlns="…" viewBox="0 0 448 512" width="16" height="16"
//      fill="#ccc" stroke="#ccc" stroke-width="0">…</svg>
```

`color` must be a literal CSS colour. VS Code renders QuickPick icons and hover
images outside any theme CSS scope, so the `currentColor` that `react-icons`
emits at runtime would come out invisible. Callers pick the literal from
`window.activeColorTheme.kind`.

## Upgrading react-icons

1. `npm install react-icons@<version>`
2. `npm run generate-index`
3. Regenerate `ICON-LICENSES.md` if the set list or licenses changed — sets do
   get added between minor versions.
4. `npm test` — the suite asserts `iconCount > 40000` and that specific icons
   (`FaBeer`, `FaAddressBook` in both `fa` and `fa6`) still resolve.
5. Check the collision count if you touch the aliasing logic; it was 1,431 in
   5.7.0 and is not stable across versions.

## Dropping a set

Filter it out in `main()` in `scripts/generate-icon-index.ts` before the
`for (const entry of manifest)` loop, then regenerate. It disappears from
`names.json`, from `svg/`, from the bundle and from the `.vsix`. This is the
supported way to shed a set whose license you do not want to redistribute — see
[Licensing](./licensing.md).
