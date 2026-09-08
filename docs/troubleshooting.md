# Troubleshooting

## The picker is empty / no icons found

`assets/icon-index/` is missing. It is gitignored — a build artifact, not source.

```bash
npm run generate-index
```

Confirm afterwards:

```bash
ls assets/icon-index          # manifest.json, names.json, svg/
```

Same cause if the hover never fires and the picker shows nothing at all.

## "Insert React Icon" is missing from the right-click menu

The context key `reactIcons.isReactFile` is false. It requires:

- language id is `javascript`, `javascriptreact`, `typescript` or
  `typescriptreact`, **and**
- for plain `.js`/`.ts`, the **first 4 KB** contains a React import or JSX.

A `.ts` file with the React import below 4 KB of other code will not qualify.
The Command Palette entry gates on language only, so it still works there.

## The extension never activates

Activation is `onLanguage:*` for four languages. Opening a `.json`, `.md` or
`.css` file activates nothing — by design.

## Nothing happens when I pick an icon

Check the error notification. The likely one:

> React Icons Inserter needs an open workspace folder to place the icon barrel
> file.

There is no workspace folder. The barrel needs a root to be relative to.

## Two barrel files exist

> Both react-icons.ts and .js exist in the barrel folder. Using the .ts file;
> delete the other to remove the ambiguity.

Delete the one you do not want. Nothing is removed automatically. See
[Barrel file](./barrel-file.md#language-detection).

## The barrel was created as .js and I wanted .ts

Detection order is: existing file → `reactIcons.language` → active file
extension → `tsconfig.json` at the root. A `.js` result means none of those
indicated TypeScript at the time.

Delete the barrel, set `reactIcons.language` to `ts`, insert again. An existing
file always wins over the setting, so the delete is necessary.

## My icon got renamed to FaSomethingFa6

Not a bug. That name already existed in the barrel from a different set, so both
were kept and the newcomer was aliased. `react-icons` 5.7.0 has 1,431 names
shared across `fa`/`fa6`, `io`/`io5` and `hi`/`hi2`.

Rename either export by hand if you prefer — the hover resolves through the
barrel either way. Detail in [Barrel file](./barrel-file.md#collisions).

## Ctrl+Z did not undo the barrel change

Expected, and documented. VS Code keeps a **separate undo stack per document**.
Undo in the component reverts the JSX and the import together; the barrel needs
its own undo, in that file.

No API joins undo stacks across documents. A leftover re-export is an unused
export — harmless. See
[Imports & edits](./imports-and-edits.md#atomicity-and-undo).

## A second import line appeared instead of merging

The existing import uses a specifier the extension cannot prove points at the
barrel — typically a tsconfig `paths` alias:

```ts
import { FaBeer } from '@/icons/react-icons';
```

Only relative specifiers are resolved on disk. A non-relative one matches only
if it is the exact string the extension would have generated. Resolving `paths`
mappings is out of scope; guessing wrong and merging into the wrong import is
worse than adding a line. See
[Imports & edits](./imports-and-edits.md#merging-a-named-import).

## "Cursor is inside the import statement being updated"

The caret was inside the import declaration being rewritten, so the JSX write
and the import edit would have overlapped. A `WorkspaceEdit` with overlapping
ranges in one document is rejected wholesale, so the JSX write was dropped and
the import was still added.

Move the caret into the JSX and insert again.

## Hover does not show for an icon that is clearly an icon

The hover verifies rather than pattern-matches. All of these must hold:

1. `reactIcons.enableHoverPreview` is on.
2. The identifier is a **named import** in that file.
3. That import's specifier **resolves on disk** to the barrel (so a `paths`
   alias fails here, same as above).
4. The barrel re-exports the name from a `react-icons/<set>` path.
5. The index contains that `(name, set)` pair.

Most commonly it is 3. Full chain in [Hover](./hover.md#the-verification-chain).

## Hover previews are invisible

A theme mismatch. The SVG is filled with a literal colour chosen from
`window.activeColorTheme.kind` — `#3b3b3b` on light, `#cccccc` on dark — because
VS Code renders hover images outside theme CSS, where `currentColor` resolves to
nothing. A custom theme reporting an unexpected kind can land on the wrong side.

## Search feels slow

- Check `reactIcons.searchDebounceMs`. `0` runs a scan on every keystroke.
- The first query of a session is ~4× slower than the rest (JIT warmup).
- The first preview from a large set loads its JSON — up to 24 ms for `pi.json`.
- Set `reactIcons.enableQuickPickPreviews` to `false` to skip set loading
  entirely during search.

Expected warm cost is 10–20 ms per query. Anything much worse is a regression —
see [Performance](./performance.md#regression-checklist).

## Startup got slow after a code change

Almost certainly a value import of `ts-morph` in a file reachable from
`extension.ts`, which pulls the TypeScript compiler back into the startup
bundle:

```bash
node esbuild.js --production && ls -la dist
# extension.js should be tens of KB. Megabytes means it leaked in.
```

Use `import type`, or `getKindName()` instead of `SyntaxKind`. See
[Performance § Two bundles](./performance.md#two-bundles).

## react-icons prompt keeps/never appears

It fires at most **once per workspace folder per session**, and only when
`react-icons` is absent from both `dependencies` and `devDependencies`. It stays
silent if `package.json` is missing or unparseable. Disable with
`reactIcons.checkReactIconsDependency`.

Reload the window to re-arm it.

## Generator fails

`npm run generate-index` requires the devDependencies — `react`, `react-dom`,
`react-icons`. Run `npm install` first.

If a set fails to render, the generator warns per icon and continues, then
reports a skipped count in the summary. A whole set missing means its
`index.js` was not found under `node_modules/react-icons/<id>/`, which usually
means a `react-icons` major version changed the layout.
