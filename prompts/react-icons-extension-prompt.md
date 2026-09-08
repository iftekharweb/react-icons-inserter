# Build Prompt: "React Icons Inserter" VS Code Extension

Copy everything below into a new Claude conversation (or Claude Code) to build the extension.

---

## Project Overview

Build a VS Code extension called **React Icons Inserter** that lets developers search, preview, and insert icons from the `react-icons` npm package directly into React/TSX files, with automatic import management and hover previews.

## Core Features

### 1. Right-click context menu → icon search picker
- Add an entry to the editor's right-click context menu, visible only in `.jsx`/`.tsx`/`.js`/`.ts` files (or more precisely, only when the file appears to be a React file — check for a React import or JSX syntax).
- Also register the same command in the Command Palette (`Insert React Icon`) and bind it to a configurable keyboard shortcut.
- Clicking it opens a `QuickPick` (VS Code's native searchable list UI) that:
  - Lets the user type a fuzzy search query (e.g., "beer", "arrow-left", "home")
  - Shows matching icons live as they type, debounced (~120ms) so it doesn't lag on every keystroke
  - Displays each result with: icon name (e.g., `FaBeer`), the icon set/library it belongs to (e.g., Font Awesome, Feather, Material Design), and a small rendered SVG preview next to the label if the QuickPick API allows it (`iconPath` using a data URI)
  - Supports scrolling/paging through results — cap visible results at ~50 at a time for performance, refine as the user narrows the query

### 2. Insert + centralized icon barrel file (NOT direct `react-icons` imports)

**Icons must never be imported directly from `react-icons/*` in the file being edited.** Instead, the extension maintains a single centralized barrel file that re-exports every icon the user has ever inserted, and target files import only from that barrel file.

**Barrel file location & naming:**
- Path: `<workspace root>/icons/react-icons.{js,ts}`
- Language auto-detection: on first use, check whether the workspace looks like a TypeScript project (presence of `tsconfig.json`, or the target file being edited is `.ts`/`.tsx`) → create `react-icons.ts`; otherwise create `react-icons.js`.
- If the file already exists (either extension), reuse it as-is and don't create the other variant. If somehow both exist, prefer `.ts` and warn the user via a VS Code notification about the ambiguity.
- Create the `icons/` folder if it doesn't exist.

**Barrel file contents:**
- Each inserted icon becomes a re-export line, e.g.:
  ```ts
  export { FaBeer } from 'react-icons/fa';
  export { MdHome } from 'react-icons/md';
  ```
- Before adding a new re-export, check (via `ts-morph`) whether that exact icon is already re-exported anywhere in the barrel file (dedupe by icon name — react-icons names are unique per set, but two different sets could theoretically export a same-named icon with a different import path, so dedupe by `(name, source path)` pair, and if a name collision from a different set occurs, keep both but flag it so the user can rename one — don't silently drop either).
- Keep re-exports sorted (alphabetically by icon name, or grouped by source set — your call, just be consistent) for readability as this file grows.

**Insertion flow when the user selects an icon from the picker:**
1. Insert the icon as JSX at the current cursor position in the active file, e.g. `<FaBeer />` (same as before — cursor-position insert, or insert-at-cursor if there's a selection).
2. Ensure the icon has a re-export entry in `icons/react-icons.{js,ts}` (create the barrel file if it doesn't exist yet; add the re-export line if missing; no-op if already present).
3. In the active file, ensure there's an import of that icon **from the barrel file**, using a **relative path** computed from the active file's location to `icons/react-icons.{js,ts}` (e.g., `import { FaBeer } from '../../icons/react-icons';`). Compute this relative path correctly regardless of how deeply nested the active file is — use Node's `path.relative` and normalize to forward slashes, and drop the file extension in the import specifier (standard JS/TS resolution).
4. If the active file already has an import from that barrel path, merge the new name into the existing named-import list (dedupe, avoid duplicate specifiers) rather than adding a second import line.
5. Use **`ts-morph`** for all of the above AST edits (both the barrel file's re-exports and the active file's import), not regex, for reliability across edge cases (existing multi-line imports, aliasing, etc.).

**Atomicity:** All edits across both files (icon JSX insertion + active file's import + barrel file's re-export) should be applied as a **single logical operation**. Since `WorkspaceEdit` can span multiple files, use one `WorkspaceEdit` covering both documents and apply it in one `vscode.workspace.applyEdit()` call so:
   - Undo (Ctrl+Z) in the active file and the barrel file revert together where possible (note VS Code's per-document undo stacks — document this limitation clearly rather than overpromising perfect cross-file undo).
   - If the barrel file isn't currently open in an editor, still edit it on disk correctly (open it programmatically as a background text document, edit, and save — or use `vscode.workspace.fs` + `WorkspaceEdit` against its URI without forcing it into a visible tab).

**Edge case to handle explicitly:** if the user runs the picker from a file that itself lives inside `icons/react-icons.{js,ts}` (i.e., they're editing the barrel file directly), just add the re-export there and skip the "import from barrel" step, since it would be self-importing.

### 3. Hover preview
- Register a `HoverProvider` for `javascript`, `javascriptreact`, `typescript`, `typescriptreact`.
- When hovering over a symbol that matches a known react-icons icon name **and** is confirmed to be imported from the centralized `icons/react-icons.{js,ts}` barrel file in that file (don't just pattern-match any capitalized word — actually check the file's import statements and resolve the import path to confirm it points at the barrel file, to avoid false positives on unrelated components), show:
  - The icon name and its set
  - A rendered SVG preview (via `MarkdownString` with `isTrusted` and an embedded base64 data URI image, or an SVG data URI if VS Code's markdown renderer supports it in the current stable version — verify this and use whichever renders reliably)
  - Optionally, a "Change icon" link that re-triggers the picker to swap it (nice-to-have, not required for v1)

### 4. Icon index (build-time, not runtime)
`react-icons` doesn't ship a clean searchable JSON index, so:
- Write a **build script** (`scripts/generate-icon-index.js` or `.ts`) that runs at development/build time (not shipped to end users, not run on their machine) to:
  - Walk `node_modules/react-icons/*/index.d.ts` (or the `.esm.js` files) for every icon subset (fa, fa6, md, io, io5, bi, bs, ai, ri, fi, gi, gr, hi, hi2, im, si, sl, tb, tfi, ti, vsc, wi, cg, di, du, lu, pi, rx)
  - Extract: icon name, set name, and the actual SVG path/shape data (react-icons stores this as `GenIcon` calls with JSON tree data — you'll need to parse that structure, likely by requiring the `.js` files directly in a Node script rather than regex-parsing)
  - Output a single static JSON (or a set of per-icon-library JSON files, lazy-loaded) bundled into the extension, containing: `{ name, set, tags/keywords, svgPathData }`
  - This index will be large (react-icons has 10,000+ icons) — **do not load it all into memory eagerly**. Lazy-load per-set JSON files only when the user's search query implies that set, or load a lightweight name-only index for search and fetch full SVG data on demand for the ~50 visible results.
- Build a lightweight fuzzy-search index over icon names/tags at extension activation time using a small, fast fuzzy-match library (e.g., `fuse.js` with tuned threshold/keys) rather than a naive substring filter, so "arrl" can still find "arrow-left"-type icons reasonably.

## Performance & Optimization Requirements (explicit — please justify choices in comments)

- **Extension activation**: Use lazy activation events (`onCommand:reactIcons.insert`, plus hover provider registration only for relevant languages) — do NOT activate on `*` or on VS Code startup.
- **Icon index loading**: Load only a lightweight name/set/tags index at activation (should be well under a few MB); defer loading full SVG path data until an icon is actually rendered as a preview (in the QuickPick or hover).
- **Search debounce**: Debounce QuickPick `onDidChangeValue` input (~100–150ms) before running fuzzy search, and cancel superseded searches so fast typing doesn't queue up stale work.
- **Caching**: Cache parsed SVG data for icons already previewed/hovered in this session (in-memory `Map`) to avoid re-parsing on repeat hovers.
- **Bundle size**: Use `esbuild` (via `vsce`'s recommended bundling setup) to bundle and minify the extension into a single `dist/extension.js`, with the icon index shipped as separate static JSON assets rather than inlined into the JS bundle.
- **AST edits**: Reuse a single `ts-morph` `Project` instance per file edit rather than re-instantiating it per keystroke or per command invocation; dispose/cleanup appropriately.
- **No blocking work on the extension host's main thread** for anything beyond a few ms — if index building at first run is slow, show a VS Code progress notification and do it asynchronously.

## Tech Stack

- TypeScript
- VS Code Extension API (`vscode` module)
- `ts-morph` for import/AST manipulation
- `fuse.js` (or similar) for fuzzy search
- `esbuild` for bundling
- Build-time script to generate the icon index from `react-icons` (as a `devDependency`, not runtime dependency — the extension should NOT require the user to have `react-icons` installed in their own project's `node_modules` for the picker/hover to work, since the SVG data is pre-baked into the extension's own bundled index; but the generated barrel file's re-exports still assume the user has or will install `react-icons` as a runtime dependency in their project — the extension should optionally check if `react-icons` is listed in the workspace's `package.json` dependencies and offer to add it / prompt the user to `npm install react-icons` if missing)

## Deliverables

1. Full extension project structure:
   - `package.json` with correct `contributes` (commands, menus, keybindings, configuration), `activationEvents`, `engines.vscode`
   - `src/extension.ts` — activation, command registration, hover provider registration
   - `src/iconIndex.ts` — index loading, lazy loading, caching
   - `src/quickPick.ts` — search UI logic
   - `src/importManager.ts` — ts-morph based import/insert logic
   - `src/barrelFile.ts` — locates/creates `icons/react-icons.{js,ts}`, manages re-exports, computes relative import paths from any active file
   - `src/hoverProvider.ts`
   - `scripts/generate-icon-index.ts` — build-time index generator
   - `esbuild.js` — bundling config
   - `README.md` explaining features, install, and usage
   - `.vscodeignore` and `LICENSE` (MIT)
2. A short explanation of any performance trade-offs made and why.
3. Basic instructions for testing locally via `F5` (Extension Development Host) before publishing.
4. Note on `react-icons`' underlying icon-set licenses (since SVG data is being redistributed inside the extension) so I can double check attribution/licensing before publishing.

## Out of Scope for v1 (mention but don't build)

- Icon color/size customization UI
- Support for non-React frameworks (Vue, Svelte icon sets)
- Multi-icon batch insert
- Telemetry/analytics

---

Please build this step by step: start with the project scaffold and `package.json` contributions, then the icon index generator, then the QuickPick + insert/import logic, then the hover provider, then bundling config. Explain key design decisions as you go, especially anywhere you deviate from what's described above.
