# Development

## Setup

```bash
npm install
npm run generate-index    # ~10 s, writes assets/icon-index/ (33 MB, gitignored)
npm run build             # dist/extension.js + dist/astWorker.js
```

`generate-index` is required on a fresh clone. `assets/icon-index/` is a build
artifact and is not committed — without it the picker finds nothing and the
hover never fires.

Requirements: Node 18+ (developed on 24), VS Code 1.85+.

## Running it

Press **F5**. `.vscode/launch.json` runs `npm: build` first and opens an
Extension Development Host.

In that window:

1. Open any folder — or create one with `App.tsx`:
   ```tsx
   export const App = () => <div />;
   ```
2. Put the caret inside the JSX, press `Ctrl+Alt+I`.
3. Type `beer`, pick `FaBeer`.
4. Verify:
   - `icons/react-icons.ts` was created,
   - `App.tsx` gained `import { FaBeer } from './icons/react-icons';`,
   - `<FaBeer />` landed at the caret.
5. Hover `FaBeer` — preview, set name, and a **Change icon** link.

`npm run watch` rebuilds on save; use **Developer: Reload Window** in the host
to pick changes up. The host does not hot-reload extension code.

## Manual test checklist

The automated suite covers the text-producing logic. These need a real host:

- [ ] Context menu shows in `.tsx`; hidden in a plain `.ts` with no React.
- [ ] `Ctrl+Alt+I` bound and working.
- [ ] QuickPick previews render (they depend on VS Code honouring `data:` URIs
      in `iconPath` — the one thing the stub cannot verify).
- [ ] **Show more** widens the result list.
- [ ] Hover image renders in both a light and a dark theme.
- [ ] **Change icon** swaps the tag and keeps props.
- [ ] Insert into a file that is unsaved/dirty.
- [ ] Insert with the barrel open in another tab — it updates live.
- [ ] `react-icons` missing from `package.json` → prompt appears once, and
      **Install** opens a terminal running `npm install react-icons`.

## Code conventions

**Never value-import `ts-morph` outside `astWorker.ts`.** `import type` only.
A value import anywhere reachable from `extension.ts` pulls the TypeScript
compiler back into the startup bundle and silently costs 320 ms.
`barrelFile.ts` uses `statement.getKindName() === 'ExportDeclaration'` instead
of importing `SyntaxKind` for this reason. Verify with `ls -la dist` after
building.

**Read ts-morph node offsets before mutating.** Mutation invalidates positions.
See [Imports & edits](./imports-and-edits.md#the-offsets-bug-worth-knowing-about)
for the bug this caused.

**Keep planning functions pure.** `planBarrelUpdate` and `planNamedImport` take
text and return text or offsets. No VS Code calls, no I/O. That is what makes
them testable and what keeps `insertIcon` the only place that talks to the
workspace.

**Comments explain decisions, not mechanics.** The reason a thing is done the
awkward way is the part a reader cannot recover from the code.

`tsconfig.json` runs `strict`, `noUnusedLocals`, `noUnusedParameters`,
`noImplicitReturns`, `noFallthroughCasesInSwitch`. `npm run compile` must be
clean.

## Adding a setting

1. Declare it under `contributes.configuration.properties` in `package.json`,
   with a default and a description.
2. Read it with a resource scope:
   `vscode.workspace.getConfiguration('reactIcons', document.uri).get(...)`.
3. Document it in [Configuration](./configuration.md).

## Bundling

`esbuild.js`, two entry points:

```js
entryPoints: ['src/extension.ts', 'src/astWorker.ts'],
outdir: 'dist',
external: ['vscode'],       // provided by the host, never bundle it
target: 'node18',
minify: production,
sourcemap: !production,
```

`vscode` must stay external. `target: node18` matches the Electron runtime in
VS Code 1.85+.

## Release

```bash
npm run compile        # typecheck
npm test               # 23 assertions
npm run package        # runs vscode:prepublish -> generate-index && build
```

Then, before publishing:

- [ ] Bump `version` in `package.json`.
- [ ] Regenerate `ICON-LICENSES.md` if `react-icons` changed
      (see [Licensing](./licensing.md)).
- [ ] Set a real `publisher`, and check `repository` points where you think.
- [ ] Read [Licensing](./licensing.md). The artwork is not MIT.
- [ ] Sanity-check the `.vsix` contents: `npx vsce ls`.

Expected package: 41 files, ~12 MB.

## Repository layout

```
src/                    extension source (see Architecture)
scripts/
  generate-icon-index.ts   build-time index generator
test/
  run.ts                   the suite
  vscodeStub.ts            in-memory `vscode` + fake filesystem
assets/icon-index/      generated JSON — gitignored, never hand-edited
dist/                   esbuild output — gitignored
docs/                   this documentation
esbuild.js              two-entry bundling config
ICON-LICENSES.md        per-set attribution, generated from the manifest
```
