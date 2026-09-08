# Architecture

## Module graph

Arrows point from importer to imported. Nothing here is circular — that
constraint is why `astProject` and `dependencyCheck` exist as separate files.

```
extension.ts ──┬──> quickPick.ts ──────> iconIndex.ts
               ├──> importManager.ts ──┬─> barrelFile.ts ──> astProject.ts
               │                       ├─> dependencyCheck.ts
               │                       └─> astProject.ts
               ├──> hoverProvider.ts ──┬─> barrelFile.ts
               │                       ├─> importManager.ts  (specifierPointsAtBarrel)
               │                       ├─> iconIndex.ts
               │                       └─> astProject.ts
               └──> astProject.ts       (disposeProject only)

astProject.ts ··runtime require··> astWorker.ts ──> ts-morph
```

The dotted edge is deliberate and is the only non-static link in the graph. See
[Performance § Two bundles](./performance.md#two-bundles).

| File | Lines | Responsibility |
|---|---:|---|
| `src/extension.ts` | 153 | Activation, command registration, the `reactIcons.isReactFile` context key, hover registration. |
| `src/iconIndex.ts` | 360 | Loading the static index, tiered search, lazy per-set SVG loading, data-URI cache. |
| `src/quickPick.ts` | 177 | Picker UI: debounce, cancellation, two-pass preview rendering, paging. |
| `src/barrelFile.ts` | 279 | Locating/creating the barrel, planning its new contents, collision aliasing, relative specifiers. |
| `src/importManager.ts` | 287 | Named-import merging, and assembling the one `WorkspaceEdit` that spans both files. |
| `src/hoverProvider.ts` | 202 | Hover previews, gated on a three-step import verification. |
| `src/astProject.ts` | 65 | Deferred loader for the AST layer. Contains no `ts-morph` value imports. |
| `src/astWorker.ts` | 81 | The `ts-morph` layer: the shared `Project` singleton and `withSourceFile`. |
| `src/dependencyCheck.ts` | 59 | One-time-per-workspace `react-icons` dependency prompt. |

## Activation lifecycle

```
VS Code opens a .js/.jsx/.ts/.tsx file
  └─> activationEvents fires  (onLanguage:* — never "*", never onStartupFinished)
      └─> require dist/extension.js          ~11 ms   (43 KB; no ts-morph)
          └─> activate()                     ~0 ms    (zero I/O)
              ├─ new IconIndex(extensionPath)         (constructor only — reads nothing)
              ├─ registerHoverProvider(4 languages)
              ├─ registerCommand × 2
              └─ setContext reactIcons.isReactFile
```

Nothing is read from disk until the user does something. The two lazy loads are:

- **First search or hover** → `IconIndex.load()` reads `manifest.json` +
  `names.json` (~30 ms).
- **First AST edit** → `astProject` runtime-requires `dist/astWorker.js`, which
  initialises `ts-morph` (~320 ms, once).

`onLanguage:*` events are required, not incidental: a hover provider must be
registered before a hover can happen, so command-only activation would leave
hovers dead until the user invoked the picker once.

## Data flow: one insert

`reactIcons.insert`, from keypress to written files.

```
1  extension.ts        runInsert()
                       └─ needs an active editor, else warns and stops

2  quickPick.ts        pickIcon(index, scope)
                       ├─ show the QuickPick immediately, busy = true
                       ├─ index.load()            first call only, ~30 ms
                       ├─ onDidChangeValue -> debounce 120 ms -> runSearch()
                       │    ├─ cancel the previous CancellationTokenSource
                       │    ├─ index.search(query, limit, token)
                       │    ├─ set items (text only)   <- first paint
                       │    └─ attachPreviews()        <- second pass, async
                       └─ resolves with one IconRef (or undefined on hide)

3  importManager.ts    insertIcon(editor, icon)
   ├─ barrelFile.locateBarrel(document)      -> BarrelLocation
   │    warns if both .ts and .js exist
   ├─ read the barrel through openTextDocument (respects unsaved edits)
   ├─ barrelFile.planBarrelUpdate(...)       -> { newText, changed,
   │                                              exportedName, collisionWith }
   ├─ build ONE WorkspaceEdit:
   │    ├─ createFile(barrel, contents)   if the barrel does not exist
   │    ├─ replace(barrel, wholeRange)    if it exists and changed
   │    └─ set(activeDoc, [ jsxEdit, importEdit ])
   │         importEdit from planNamedImport(); ranges are checked for overlap
   ├─ workspace.applyEdit(edit)              <- single atomic call
   ├─ save the barrel document if it is dirty
   ├─ warn if a collision forced an alias
   └─ dependencyCheck.ensureReactIconsDependency()   fire-and-forget

4  extension.ts        inform the user if the barrel was newly created
```

Two branches short-circuit step 3:

- **Editing the barrel itself** — no JSX, no import; the re-export is the whole
  operation.
- **Caret inside the import being rewritten** — the JSX edit is dropped rather
  than producing overlapping ranges, and the user is told.

## Data flow: one hover

```
hoverProvider.provideHover(document, position, token)
  1  config gate            reactIcons.enableHoverPreview
  2  word at position       must be >= 3 chars and start uppercase   <- pre-I/O bail
  3  locateBarrel()         must exist
  4  readImports()          the word must be a named import that RESOLVES
                            on disk to the barrel        [cached by doc version]
  5  readBarrelExports()    the barrel must re-export it from react-icons/*
                            (this also un-aliases FaAddressBookFa6) [cached]
  6  index.load()           + resolveByName() filtered by set
  7  render                 MarkdownString with a base64 SVG data URI
```

Every step can bail. Steps 2 and 3 exist specifically so the common case — a
hover over ordinary code — costs a regex test and nothing else.

## Threading and blocking

There is one thread: the extension host's. Everything below is a deliberate
consequence.

- File reads are `fs/promises` or `workspace.fs`, so they yield.
- `JSON.parse` of a set file is synchronous and blocking (~24 ms for the 4.3 MB
  `pi.json`). It happens once per set per session, off a user action.
- The search scan is synchronous but bounded at 3–13 ms, and polls its
  cancellation token every 4,096 icons so a superseded keystroke abandons work
  mid-scan.
- `ts-morph` parsing is synchronous. Files are parsed one at a time, on user
  actions, and hover parses are cached by document version.

No worker threads, no child processes. The measured budget is in
[Performance](./performance.md).
