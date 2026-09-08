# Barrel file

`src/barrelFile.ts`. The central rule of this extension: **components never
import `react-icons/*`**. One generated file re-exports every icon the user has
inserted, and components import from that.

```ts
// icons/react-icons.ts
// Centralised react-icons barrel.
// Generated and maintained by the "React Icons Inserter" VS Code extension.
// Add icons through the picker so imports stay in sync; hand edits are preserved.

export { FaBeer } from 'react-icons/fa';
export { FaAddressBook } from 'react-icons/fa';
export { FaAddressBook as FaAddressBookFa6 } from 'react-icons/fa6';
export { MdHome } from 'react-icons/md';
```

## Location

`<workspace root>/<reactIcons.barrelDirectory>/<reactIcons.barrelFileName>.{ts,js}`
— by default `icons/react-icons.{ts,js}`.

The workspace folder is the one owning the active document, falling back to the
first folder. With no folder open at all, the insert fails with an explanatory
message rather than guessing a path.

### Language detection

`locateBarrel()` decides in this order:

1. **An existing barrel wins.** If `react-icons.ts` or `react-icons.js` is
   already there, use it. The other variant is never created.
2. `reactIcons.language` set to `ts` or `js`.
3. The active file is `.ts`/`.tsx` → `.ts`.
4. `tsconfig.json` at the workspace root → `.ts`, else `.js`.

**Both files present.** `.ts` is used and a warning fires:

> Both react-icons.ts and .js exist in the barrel folder. Using the .ts file;
> delete the other to remove the ambiguity.

Nothing is deleted automatically.

## Contents

One re-export per line, matching the format in the brief. Grouping many icons
from one set into a single `export { … }` clause would be shorter but harder to
diff as the file grows.

**Sorting** — `reactIcons.sortBarrelExports`:

- `set` (default): by module specifier, then by exported name.
- `name`: by exported name only.

**Quote style** is detected from the file's existing content (`detectQuote`
counts `from '` against `from "`), defaulting to single.

**The header banner** is preserved. If the file starts with comments, they are
kept verbatim across regeneration; if it has none, the default banner is added.

## Regenerate vs. append

`planBarrelUpdate()` checks whether every statement is an export declaration
with a module specifier:

- **Pure barrel** → the whole file is regenerated, sorted. Cheap, deterministic,
  keeps the file tidy as it grows to hundreds of lines.
- **Anything else** — a hand-written helper, an `export *`, a type alias — →
  `ts-morph` appends one declaration in place and the rest of the file is left
  exactly as the user wrote it, in their order.

This is the rule that makes hand-editing the barrel safe. Add a constant to it
and the extension stops reordering the file.

## Dedupe

Dedupe is by the **`(name, source path)` pair**, not by name alone.

- Same name, same set → no-op. `changed: false`, `newText` is the original
  string, and no edit is queued for that file at all.
- Same name, **different** set → a collision. Both are kept.

## Collisions

`react-icons` names are unique within a set but not across sets, because several
sets share a prefix: `fa`/`fa6`, `io`/`io5`, `hi`/`hi2`. In 5.7.0 that is
**1,431 shared names** — `Fa500Px`, `FaAccessibleIcon`, `FaAddressBook` and so
on all exist in both `fa` and `fa6`.

Two un-aliased exports of one name is invalid TypeScript, so "keep both" has to
mean aliasing. The newcomer gets the set id appended in PascalCase:

```ts
export { FaAddressBook } from 'react-icons/fa';
export { FaAddressBook as FaAddressBookFa6 } from 'react-icons/fa6';
```

If that alias is somehow taken too, a counter is appended
(`FaAddressBookFa62`). The alias is what gets imported into the active file and
written as the JSX tag, and the user is told:

> FaAddressBook is already re-exported from react-icons/fa. Added it as
> FaAddressBookFa6 instead — rename either export if you prefer.

Renaming either side by hand is fine. The hover un-aliases through the barrel,
so `FaAddressBookFa6` still previews as Font Awesome 6's `FaAddressBook`.

## Relative specifiers

`barrelSpecifierFrom(fromFsPath, barrelFsPath)`:

```ts
barrelSpecifierFrom('C:\\proj\\src\\a\\b\\Widget.tsx', 'C:\\proj\\icons\\react-icons.ts')
// '../../../icons/react-icons'

barrelSpecifierFrom('C:\\proj\\icons\\Other.tsx', 'C:\\proj\\icons\\react-icons.ts')
// './react-icons'
```

Three things it has to get right, all covered by tests:

- `path.relative` from the active file's **directory**, at any nesting depth.
- Separators normalised to `/`. A Windows `\` is not valid in a module
  specifier.
- The extension is dropped, per standard JS/TS resolution.
- A result that does not start with `.` is prefixed with `./`, so a sibling file
  never emits a bare specifier that would resolve as a package.

## Edge case: editing the barrel itself

Running the picker while the barrel is the active document adds the re-export
and stops. No JSX is inserted, no import is added — a barrel importing from
itself is a cycle. `InsertResult.inserted` comes back `false`.

This also avoids a mechanical problem: the barrel's update is a whole-file
replacement, and a caret insert into the same document would overlap it. See
[Imports & edits](./imports-and-edits.md#overlapping-ranges).

## Public API

```ts
locateBarrel(activeDocument): Promise<BarrelLocation | undefined>
isBarrelDocument(document, barrel): boolean
barrelSpecifierFrom(fromFsPath, barrelFsPath): string
planBarrelUpdate(barrel, currentText, icon, sortBy): BarrelUpdate
```

`planBarrelUpdate` is pure — text in, text out, no VS Code calls, no I/O. That
is what makes the barrel logic testable without an Extension Host.

```ts
interface BarrelUpdate {
  newText: string;          // full replacement contents
  changed: boolean;         // false -> skip the write entirely
  exportedName: string;     // what the active file must import (alias-aware)
  collisionWith?: string;   // module specifier that already owned the name
}
```
