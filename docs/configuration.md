# Configuration reference

The complete contribution surface, as declared in `package.json`.

## Settings

All are workspace-scopable — `getConfiguration('reactIcons', document.uri)` is
passed a resource everywhere, so per-folder overrides work in a multi-root
workspace.

### Barrel file

| Setting | Type | Default | Effect |
|---|---|---|---|
| `reactIcons.barrelDirectory` | string | `icons` | Workspace-relative folder holding the barrel. Created if missing. |
| `reactIcons.barrelFileName` | string | `react-icons` | Base name, no extension. |
| `reactIcons.language` | `auto` \| `ts` \| `js` | `auto` | Language for a **newly created** barrel. An existing barrel always wins over this. |
| `reactIcons.sortBarrelExports` | `set` \| `name` | `set` | `set` groups by module specifier then name; `name` sorts by exported name only. Only applies to a pure barrel — see [Barrel file](./barrel-file.md#regenerate-vs-append). |

Changing `barrelDirectory` or `barrelFileName` after icons exist does not
migrate anything. The old barrel is left in place and a new one is created on
the next insert.

### Picker

| Setting | Type | Default | Effect |
|---|---|---|---|
| `reactIcons.maxResults` | number (10–200) | `50` | Results per page. **Show more** multiplies by 4; typing resets to this. |
| `reactIcons.searchDebounceMs` | number (0–1000) | `120` | Delay before a search runs. `0` searches on every keystroke — see [Search](./search.md) for what that costs. |
| `reactIcons.enableQuickPickPreviews` | boolean | `true` | The second, asynchronous pass that attaches SVG previews. Turning it off skips all set loading during search. |

### Hover

| Setting | Type | Default | Effect |
|---|---|---|---|
| `reactIcons.enableHoverPreview` | boolean | `true` | Checked first in `provideHover`, before any I/O. |

### Workspace

| Setting | Type | Default | Effect |
|---|---|---|---|
| `reactIcons.checkReactIconsDependency` | boolean | `true` | One-time-per-workspace prompt when `react-icons` is missing from `package.json`. |

The prompt fires at most once per workspace folder per session
(`dependencyCheck.ts` holds a `Set` of checked folder URIs). It reads
`package.json` once and stays silent if the file is missing or unparseable.

## Commands

| Command | Title | Palette | Context menu |
|---|---|---|---|
| `reactIcons.insert` | Insert React Icon | JS/TS languages | when `reactIcons.isReactFile` |
| `reactIcons.replaceAtCursor` | Change React Icon At Cursor | JS/TS languages | — |

`reactIcons.replaceAtCursor` accepts three optional arguments —
`(uriString, line, character)` — which is how the hover's **Change icon** link
targets a specific position. Invoked bare from the palette, it uses the caret.

It refuses if the passed URI is not the active editor's:

> Open the file containing that icon and try again.

## Keybinding

| Key | Command | When |
|---|---|---|
| `Ctrl+Alt+I` / `Cmd+Alt+I` | `reactIcons.insert` | `editorTextFocus && reactIcons.isReactFile` |

Rebindable in **Keyboard Shortcuts**.

## Context key

`reactIcons.isReactFile` gates both the context-menu entry and the keybinding.

Set by `isReactFile(document)` in `extension.ts`:

```ts
javascriptreact | typescriptreact  ->  always true
javascript | typescript            ->  true if the first 4 KB matches
                                       /(from ['"]react['"])|(require\(['"]react['"]\))
                                        |(<[A-Z][\w.]*[\s/>])|(<>)/
anything else                      ->  false
```

Recomputed on active-editor change and on edits to the active document. Only the
first 4 KB is scanned so a large file does not stall the context-menu
computation.

A `.ts` file with no React import and no JSX gets no context-menu entry — a
plain Node script has no business being offered "Insert React Icon". It is still
reachable from the Command Palette, which gates on language id only.

## Activation events

```json
["onLanguage:javascript", "onLanguage:javascriptreact",
 "onLanguage:typescript", "onLanguage:typescriptreact"]
```

Required for the hover provider to exist before the first hover. Never `*`,
never `onStartupFinished`. See [Performance](./performance.md#activation).

## npm scripts

| Script | Does |
|---|---|
| `npm run generate-index` | Regenerates `assets/icon-index/` from `node_modules/react-icons` (~10 s). |
| `npm run build` | Production bundle, minified, no sourcemap. |
| `npm run watch` | Rebuild on save, with sourcemaps. |
| `npm run compile` | `tsc --noEmit` over `src/`, `scripts/`, `test/`. |
| `npm test` | The suite — see [Testing](./testing.md). |
| `npm run package` | `vsce package`. |
| `vscode:prepublish` | `generate-index && build`, so a fresh clone cannot ship a missing index. |
