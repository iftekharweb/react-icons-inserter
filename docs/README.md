# React Icons Inserter — documentation

Internal documentation for the extension. The root [`README.md`](../README.md)
is the user-facing pitch; these pages are for people changing the code.

## Map

| Page | Read it when |
|---|---|
| [Architecture](./architecture.md) | You need the module graph, the data flow of one insert, or the activation lifecycle. |
| [Icon index](./icon-index.md) | You are touching the generator, the on-disk JSON format, or how sets are loaded. |
| [Search](./search.md) | You are changing ranking or query handling. |
| [Barrel file](./barrel-file.md) | You are changing where the barrel lives, what it contains, or how collisions resolve. |
| [Imports & edits](./imports-and-edits.md) | You are touching `ts-morph`, the `WorkspaceEdit`, or anything about atomicity and undo. |
| [Hover](./hover.md) | You are changing the hover, its verification chain, or its caching. |
| [Performance](./performance.md) | You are about to make something slower, or want the measured budget. |
| [Configuration](./configuration.md) | You need the full contribution surface: settings, commands, keybindings, context keys. |
| [Development](./development.md) | You are setting up, building, testing, or releasing. |
| [Testing](./testing.md) | You are adding tests or wondering why there is no Extension Host. |
| [Troubleshooting](./troubleshooting.md) | Something does not work and you want the likely cause. |
| [Licensing](./licensing.md) | You are about to publish, or thinking about adding/removing an icon set. |

## The one-paragraph version

The extension ships a pre-baked index of every `react-icons` icon (50,939 icons,
31 sets) as static JSON. A QuickPick searches it. Choosing an icon writes three
things in a single `WorkspaceEdit`: the JSX at the caret, a named import in the
active file, and a re-export in a central barrel file at
`<workspace>/icons/react-icons.{ts,js}`. Components never import
`react-icons/*` directly — only the barrel does. A hover provider previews icons
that it can prove came from that barrel.

## Non-negotiables

These are load-bearing. Changing one means changing a decision that was made on
purpose, so read the linked page first.

1. **Components never import `react-icons/*` directly.** The barrel is the only
   place that path appears. → [Barrel file](./barrel-file.md)
2. **All AST work goes through `ts-morph`, never regex.** →
   [Imports & edits](./imports-and-edits.md)
3. **`activate()` performs zero I/O**, and `ts-morph` is not in the startup
   bundle. → [Performance](./performance.md)
4. **The hover verifies imports; it never pattern-matches names.** →
   [Hover](./hover.md)
5. **Search must stay off the 65–160 ms path** that a naive Fuse index puts it
   on. → [Search](./search.md)
