# Changelog

All notable changes to **React Icons Inserter** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-08

First release.

### Added

- **Icon picker.** `Ctrl+Alt+I` / `Cmd+Alt+I`, the editor context menu, or the
  Command Palette. Fuzzy search across 50,939 icons from 31 `react-icons` sets,
  with rendered SVG previews and a **Show more** pager.
- **Centralised barrel file.** Icons are re-exported from
  `<workspace>/icons/react-icons.{ts,js}` and imported into components from
  there — `react-icons/*` never appears in a component. Language is
  auto-detected from `tsconfig.json` or the file being edited; an existing
  barrel always wins.
- **Import management via `ts-morph`.** New icons merge into the existing barrel
  import rather than adding a line. Multi-line clauses, aliases, default
  imports, `"use client"` prologues and double-quote codebases are all
  preserved.
- **Cross-set collision handling.** `react-icons` 5.7.0 shares 1,431 names
  between `fa`/`fa6`, `io`/`io5` and `hi`/`hi2`. Both sides are kept; the
  newcomer is aliased (`FaAddressBook` from `fa6` becomes `FaAddressBookFa6`)
  and the user is told.
- **Hover previews.** Rendered icon, set name, source module and a **Change
  icon** link. Fires only when the identifier is verifiably imported from the
  barrel, so unrelated components named `Home` or `Menu` never trigger it.
- **`reactIcons.replaceAtCursor`.** Swaps the icon at the caret, preserving the
  surrounding JSX and its props.
- **Dependency check.** A one-time-per-workspace prompt when `react-icons` is
  missing from `package.json`, offering to install it.
- **Nine settings** covering barrel location and language, result cap, search
  debounce, preview toggles, export sorting and the dependency check.
- **Build-time icon index generator** (`npm run generate-index`) that renders
  every icon with `react-dom/server` and emits static JSON.
- **23 tests** (`npm test`) running without an Extension Host.
- **Documentation** in [`docs/`](./docs/) covering architecture, the icon index,
  search, barrel semantics, imports and edits, hover, performance,
  configuration, development, testing, troubleshooting and licensing.

### Performance

- Activation is scoped to four `onLanguage:*` events — never `*`, never
  `onStartupFinished` — and `activate()` performs zero I/O.
- `ts-morph` is split into a second bundle loaded on the first AST edit, cutting
  the cost of requiring the extension from **320 ms to 11 ms**.
- Search avoids a naive `fuse.js` index over all 50,939 names (measured
  65–160 ms per query) by classifying matches in a typed loop and using Fuse
  only to rank a capped fuzzy candidate set. Warm queries land in 10–20 ms.
- The icon index loads in three tiers: 847 KB of names on first use, per-set SVG
  payloads only when an icon from that set is previewed.

### Known limitations

- **Cross-file undo.** All writes land in a single `WorkspaceEdit`, so the
  operation is atomic. Undo is not: VS Code keeps a separate undo stack per
  document, so `Ctrl+Z` in a component reverts the JSX and import together but
  not the barrel. No API joins undo stacks across documents.
- **tsconfig `paths` aliases.** Non-relative specifiers such as
  `@/icons/react-icons` are only recognised when they exactly match the string
  the extension generates. Resolving `paths` mappings is out of scope.
- **Change icon** leaves the previous icon's import in place; proving no other
  reference exists is the language server's job.

### Licensing

The extension source is MIT. The bundled SVG artwork is **not** — each icon set
carries its own terms, including CC BY 4.0 for Font Awesome 5/6 (attribution
required) and MPL-2.0 for Circum Icons. See
[`ICON-LICENSES.md`](./ICON-LICENSES.md) and [`docs/licensing.md`](./docs/licensing.md).

### Not in this release

Icon colour/size customisation UI, non-React frameworks, multi-icon batch
insert, telemetry.

[0.1.0]: https://github.com/iftekharweb/react-icons-inserter/releases/tag/v0.1.0
