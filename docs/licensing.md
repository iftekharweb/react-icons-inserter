# Licensing

**Read this before publishing.**

Two separate things are licensed here, and only one of them is MIT.

| What | License |
|---|---|
| Extension source code | MIT — [`LICENSE`](../LICENSE) |
| `react-icons` the package | MIT |
| **The icon artwork** | **Per set. Not MIT.** — [`ICON-LICENSES.md`](../ICON-LICENSES.md) |

## Why this matters here specifically

Most tools that use `react-icons` depend on it at runtime and ship none of its
artwork. This extension does the opposite: it **pre-renders and redistributes
the SVG path data for all 31 sets** inside its own `.vsix`, so the picker and
hover work without the user having `react-icons` installed.

That makes each set's terms apply to this extension's distribution. `react-icons`
being MIT covers the wrapper code, not the drawings.

The generator does not modify path data — only the wrapper `<svg>` attributes
(`viewBox`, `width`, `height`, `fill`, `stroke`) — but redistribution terms
still apply.

## Terms that need attention

Full table with counts and links in [`ICON-LICENSES.md`](../ICON-LICENSES.md).
The ones that are not a plain permissive grant:

| Set | Name | License | What it requires |
|---|---|---|---|
| `fa` | Font Awesome 5 | CC BY 4.0 | Visible attribution. 1,611 icons. |
| `fa6` | Font Awesome 6 | CC BY 4.0 | Visible attribution. 2,058 icons. |
| `ci` | Circum Icons | MPL-2.0 | File-level copyleft — the SVG data stays under MPL when redistributed. 288 icons. |

Everything else in the manifest is MIT or similar. Check the generated table
rather than trusting this summary — sets get added between `react-icons`
versions, and their license metadata comes from `react-icons`' own manifest,
which can change.

## Regenerating the attribution file

`ICON-LICENSES.md` is generated from `assets/icon-index/manifest.json`, whose
license fields are copied verbatim from `react-icons/lib/iconsManifest.js`.

Regenerate it whenever `react-icons` is upgraded:

```bash
npm run generate-index
node -e "…"   # the generator script used to build ICON-LICENSES.md
```

If you keep upgrading `react-icons`, fold that into
`scripts/generate-icon-index.ts` so the two cannot drift.

## Dropping a set

The supported way to shed a license you do not want to carry. Filter the set out
in `main()` in `scripts/generate-icon-index.ts` before the
`for (const entry of manifest)` loop, then:

```bash
npm run generate-index
npm test
npm run package
```

It disappears from `names.json`, from `svg/`, from the bundle and from the
`.vsix`. Nothing references it afterwards.

Dropping Font Awesome 5 and 6 removes the attribution requirement at the cost of
3,669 icons — the two largest and most-requested sets. Dropping Circum Icons
removes the MPL obligation for 288 icons. Both are one-line changes.

## Attribution, if you keep the CC BY sets

CC BY 4.0 wants credit to the author, a link to the license, and an indication
of whether changes were made. A Marketplace listing that satisfies this looks
roughly like:

> Icons from Font Awesome Free (https://fontawesome.com), licensed under
> CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Icon artwork is
> unmodified; SVG wrapper attributes are set at render time.

Put it in the Marketplace description and in the repository README, not only in
a file inside the package.

## Not legal advice

This page records what the metadata says and where it came from. Verify the
actual terms of every set you ship against its own license text before
publishing. The links are in [`ICON-LICENSES.md`](../ICON-LICENSES.md).
