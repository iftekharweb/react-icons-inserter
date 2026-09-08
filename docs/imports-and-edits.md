# Imports & edits

`src/importManager.ts`, `src/astProject.ts`, `src/astWorker.ts`.

## Why ts-morph and not regex

Every AST edit goes through `ts-morph`. The cases that kill a regex approach are
all ordinary code:

```tsx
import {
  FaBeer,
  MdHome as Home,
} from '../icons/react-icons';

'use client';

import type { FC } from 'react';
import React, { useState } from 'react';
```

Multi-line clauses, aliases, type-only imports, default-plus-named, directive
prologues, both quote styles, comments between imports. A parser handles all of
it; a regex handles the first case you tested.

The cost is real — `ts-morph` embeds the whole TypeScript compiler, which is
5.6 MB and ~320 ms of module init — and is paid for by the two-bundle split
described in [Performance](./performance.md#two-bundles).

## The ts-morph layer

`astWorker.ts` owns one `Project`, created on first use:

```ts
new Project({
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  manipulationSettings: { quoteKind: QuoteKind.Single },
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, allowJs: true, … },
})
```

- **One instance.** Constructing a `Project` allocates a full LanguageService
  and compiler host. Doing it per command — let alone per keystroke — is tens of
  milliseconds and a lot of garbage.
- **In-memory FS.** Nothing here touches disk. Text always arrives from a
  `vscode.TextDocument`, so unsaved editor state is respected, and leaves as a
  `WorkspaceEdit`.
- **`jsx` must be set** or every `.tsx`/`.jsx` file fails to parse.

`withSourceFile` adds a file, runs the callback, and removes it in a `finally`,
so the project stays empty between operations:

```ts
withSourceFile(filePath, text, (sourceFile) => { … })
```

Paths are flattened to `/virtual/C__proj_src_Widget.tsx` — the in-memory FS is
case-sensitive and does not understand Windows drive letters.

`astProject.ts` is the deferred loader in front of it. It contains **no
`ts-morph` value imports** — only `import type` — and reaches the worker through
a non-literal `require()` so esbuild leaves it as a runtime call. It falls back
to requiring the `.ts` source when no built worker exists, which is what lets
the test suite run against `src/`.

## Merging a named import

`planNamedImport(filePath, text, localName, specifier, barrelFsPath)` returns an
offset-based edit, or `undefined` if there is nothing to do.

**Finding the existing import.** Matched either on the exact specifier string,
or by resolving it on disk:

```ts
specifierPointsAtBarrel('C:\\proj\\src\\Widget.tsx', '../icons/react-icons',    barrel)  // true
specifierPointsAtBarrel('C:\\proj\\src\\Widget.tsx', '../icons/react-icons.ts', barrel)  // true
specifierPointsAtBarrel('C:\\proj\\src\\Widget.tsx', './other',                 barrel)  // false
```

Only relative specifiers are resolved. A bare or aliased specifier
(`@/icons/react-icons` via tsconfig `paths`) matches only if it is the exact
string this extension would have generated. Resolving `paths` mappings is out of
scope, and guessing wrong would produce a duplicate import — a worse outcome
than not merging.

**Where a new import goes.**

| Situation | Placement |
|---|---|
| Imports exist | Immediately after the last one. |
| No imports, directive prologue present | After `'use client'` / `'use strict'`. |
| No imports, statements exist | Before the first statement, at `getStart()` — which skips leading trivia, so comments above it stay put. |
| Empty file | At the end. |

Quote style comes from `detectQuote(text)`, so a double-quoted codebase gets
`from "../icons/react-icons";`.

## The offsets bug worth knowing about

`ts-morph` node positions are invalidated by mutation. This was a real bug,
caught by the test suite:

```ts
// WRONG — start/end are read after the AST has shifted
existing.addNamedImport(localName);
return { start: existing.getStart(), end: existing.getEnd(), newText: existing.getText() };
```

`addNamedImport` rewrites the source file. Afterwards the node's positions refer
to the *new* text, while the edit is applied against the *original*. The end
offset overshot by the length of `, MdHome`, and the second insert into a file
silently ate the following characters:

```tsx
import { FaBeer, MdHome } from '../icons/react-icons'; const W = () => <div />;
//                                                    ^^ "\n\nexport " gone
```

The fix is to capture the range first:

```ts
const start = existing.getStart();
const end = existing.getEnd();
existing.addNamedImport(localName);
return { start, end, newText: existing.getText() };
```

**If you mutate a node, read its offsets before you mutate it.** The test
`merges into the existing barrel import without corrupting the file` asserts on
the surrounding lines specifically to catch this class of failure.

## One WorkspaceEdit

`insertIcon()` puts every write into a single `vscode.WorkspaceEdit` and applies
it with one `applyEdit()` call:

| Op | Target | When |
|---|---|---|
| `createFile(uri, { contents })` | barrel | barrel does not exist |
| `replace(uri, wholeRange, newText)` | barrel | barrel exists and changed |
| `set(uri, [jsxEdit, importEdit])` | active file | not editing the barrel itself |

`set()` replaces all edits for a URI, so active-document edits are collected in
an array first and set once. This is also why the barrel-self-edit case skips
the document edits entirely: same URI, and `set()` would clobber the barrel's
own replacement.

Minimal edits are used for the active file rather than a whole-file
replacement — caret position, selection and folding state all survive an
offset-precise edit and do not survive a full rewrite. The barrel is the one
exception, because it is regenerated sorted.

### Overlapping ranges

A `WorkspaceEdit` with overlapping ranges in one document is rejected wholesale,
so the overlap is detected before anything is committed:

```ts
if (inserted && range.intersection(jsxRange)) {
  // caret is inside the import statement being rewritten
  documentEdits.length = 0;   // drop the JSX write
  inserted = false;
}
```

The user gets *"Cursor is inside the import statement being updated; added the
import only."* Pathological, but silently corrupting the file is not an option.

## Atomicity and undo

**Atomicity holds.** One `applyEdit()`; it either lands completely or not at
all.

**Undo does not, and the extension does not pretend otherwise.** VS Code keeps a
separate undo stack per document:

- `Ctrl+Z` in the component undoes the JSX **and** the import together — same
  document, same edit.
- It does **not** roll back the barrel. That needs its own undo, in that file.

There is no API to join undo stacks across documents. A leftover re-export is
harmless — an unused export — so no compensating logic exists. This is stated in
the root README too; it is a platform limitation, not an oversight.

After the edit, the barrel document is saved if dirty, so a file the user never
opened does not linger with unsaved changes.

## Changing an icon

`reactIcons.replaceAtCursor` (the hover's **Change icon** link) reuses
`insertIcon` with `{ replaceRange, identifierOnly: true }`. Only the identifier
is swapped, so `<FaBeer className="x" />` keeps its props.

The previous icon's import is deliberately left alone. Removing it safely means
proving no other reference exists in the file — that is the language server's
job, and getting it wrong deletes a working import.
