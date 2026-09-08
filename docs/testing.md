# Testing

```bash
npm test
```

23 assertions, plain Node, no Extension Host. Runs in a couple of seconds.

## Why no Extension Host

`@vscode/test-electron` downloads a VS Code build, launches it, and runs tests
inside the host. That is the right tool for verifying VS Code *behaviour* — does
a `data:` URI actually render in a QuickPick `iconPath`, does the context menu
appear.

It is the wrong tool for what actually breaks here, which is **the text this
extension writes into files**. Those assertions want to run in under a second,
on every save, without a download step.

So `test/vscodeStub.ts` provides an in-memory `vscode` module and a fake
filesystem. Modules under test are required with `vscode` resolved to the stub,
and captured `WorkspaceEdit` operations are replayed onto a `Map` of file
contents. The assertions are then about the exact bytes the extension would have
written.

The things the stub cannot verify are listed as a manual checklist in
[Development](./development.md#manual-test-checklist).

## How the stub works

```ts
installVscodeStub();   // MUST run before requiring anything that imports vscode
```

It patches `Module._resolveFilename` to map `'vscode'` to a fake id, and seeds
`require.cache` with the stub object. That is why the requires in `test/run.ts`
are `require(...)` calls after the install, not top-level `import`s — ESM
imports are hoisted and would load the real resolution first.

The stub implements only what the code touches: `Position`, `Range` (with a real
`intersection`), `Uri.joinPath/parse`, `TextEdit.replace`, `WorkspaceEdit`,
`MarkdownString`, `Hover`, `ColorThemeKind`, and the `window`/`workspace`
surfaces including `workspace.fs`.

`commit()` replays the captured ops:

```ts
create  -> files.set(path, contents)
replace -> files.set(path, newText)
set     -> splice each TextEdit into the document, back to front
```

Back-to-front so earlier offsets stay valid as later ones are spliced — the same
thing VS Code does.

## What is covered

**Barrel file (5)** — creation from nothing, sort order by set, no-op on a
duplicate, cross-set collision aliasing, append-instead-of-regenerate when the
barrel has hand-written code.

**Relative specifiers (2)** — depth and separator normalisation; equivalence of
`../icons/react-icons`, `…/react-icons.ts`, and rejection of unrelated or bare
specifiers.

**Import planning (6)** — insertion after existing imports, merging without
corruption, no-op when already imported, merging into an import written with an
extension, placement after a `'use client'` prologue, double-quote preservation.

**Insert flow (5)** — barrel created as `.ts` when `tsconfig.json` exists;
import and JSX both land; the component never gains a `react-icons/*` import;
second icon merges into one import; re-inserting a known icon changes nothing;
collision aliases end to end and warns; running inside the barrel adds only the
re-export and never self-imports.

**Hover (3)** — an aliased icon resolves back to its real set and renders a data
URI; a plain barrel icon renders; a non-barrel identifier (`React`) produces no
hover.

**Icon index (2)** — loads >40,000 icons, exact and pasted-name queries rank
correctly, a nonsense query returns zero, `arrl` still reaches arrow icons
through the fuzzy tier, data URIs render; and search honours cancellation.

## A bug it caught

The suite paid for itself during development. `planNamedImport` read `ts-morph`
node offsets *after* calling `addNamedImport`, which invalidates them. The
resulting edit overshot by the length of the inserted text and ate part of the
file on the second insert:

```tsx
import { FaBeer, MdHome } from '../icons/react-icons'; const W = () => <div />;
//                                                    ^^ "\n\nexport " gone
```

A weak assertion (`/\{ FaBeer, MdHome \}/` matched fine) hid it. The test now
asserts on the surrounding lines:

```ts
assert.match(result, /^import React from 'react';\n/);
assert.match(result, /\nexport const W = \(\) => <div \/>;\n$/);
```

**When asserting on generated text, assert that the surrounding text survived.**
Matching only the part you added will not catch a range that is too wide.

## Adding a test

```ts
await test('describes the behaviour, not the function name', () => {
  // arrange with files.set(norm(path), contents)
  // act
  // assert
});
```

`test()` catches, prints the stack indented, records a failure and continues, so
one break does not hide the rest. The process exits non-zero if anything failed.

For anything involving `insertIcon`, call `reset()` first, seed `files`, and
call `commit()` after each insert to make the writes visible to the next one.

Prefer a pure function where you can: `planBarrelUpdate` and `planNamedImport`
need no stub state at all.

## Real data, on purpose

The index tests load the actual generated index and assert on real icons —
`FaBeer`, and `FaAddressBook` which genuinely exists in both `fa` and `fa6`.

An earlier version of the collision test used `FaBeer` from `fa6`, which does
not exist. The barrel assertions passed (the barrel logic never checks that an
icon is real) but the hover test failed, because the hover *does* resolve
against the index. Synthetic icon names will pass the text-level tests and fail
the moment anything consults the index — use names that exist.
