# Pickers

Two implementations, selected by `reactIcons.pickerStyle`.

| | Grid (`grid`, default) | List (`list`) |
|---|---|---|
| Implementation | Webview panel — `src/gridPicker.ts` + `media/` | Native `QuickPick` — `src/quickPick.ts` |
| Icon size | 16–96 px, live slider | Fixed ~16 px, not adjustable |
| Layout | Reflowing CSS grid | Single column |
| Page size | 120 | `reactIcons.maxResults` (50) |
| Opens as | An editor tab | An overlay |
| Best for | Browsing by shape when you do not know the name | Typing a name you already know |

## Why the grid needs a webview

`QuickPick` cannot render one, and no combination of settings changes that:

- It is a **fixed single-column list**. There is no layout hook.
- `QuickPickItem.iconPath` renders at a fixed size, around 16 px. The SVG's own
  `width`/`height` are ignored — the extension already writes them and they have
  no effect on the row.
- Row height is not configurable.

Browsing by shape needs glyphs big enough to recognise and enough of them
on screen at once to scan. That means owning the layout, which means a webview.

The QuickPick was kept rather than replaced. It is genuinely faster when you
know the name: it opens instantly over the editor, never steals a tab, and the
hands never leave the keyboard.

## Division of labour

The webview owns **presentation and input only**. Searching stays in the
extension host, which already holds the 51k-name index.

```
webview  ──'search', requestId, query, limit──>  host
                                                 index.search()
                                                 index.getSvg() per result
host     ──'results', requestId, icons, total──>  webview
                                                 renders the grid
webview  ──'pick', name, set──────────────────>  host  resolves + closes
```

The host ships at most one page at a time, so the 33 MB of SVG data never
crosses the bridge. A page of 120 icons is roughly 120 KB of path data.

Icons travel as `{ name, set, setLabel, viewBox, body }` — the raw geometry, not
a data URI. Two reasons: it is smaller, and it lets the webview colour the glyph
with `currentColor`, so a selected cell inverts to the theme's selection
foreground like every other list in VS Code.

### Message protocol

| Direction | Message | Purpose |
|---|---|---|
| → host | `ready` | Webview script has loaded and wants its configuration. |
| → webview | `init` | `iconSize`, `pageSize`, `debounceMs`, size bounds. |
| → host | `search` | `requestId`, `query`, `limit`. |
| → webview | `results` | `requestId`, `icons`, `total`, `limit`. |
| → host | `pick` | `name` + `set` of the chosen icon. |
| → host | `cancel` | Escape was pressed. |
| → host | `sizeChanged` | Slider released; persist to settings. |

`requestId` is a monotonic counter. The webview drops any `results` whose id is
not the newest request it issued, which is the webview-side equivalent of the
QuickPick's `CancellationTokenSource`. Debouncing happens in the webview, on the
`input` event, using the same `reactIcons.searchDebounceMs` value.

## Content security

```
default-src 'none';
style-src ${webview.cspSource};
script-src 'nonce-${nonce}';
font-src ${webview.cspSource};
```

The grid sets `svg.innerHTML` from index data. That data is generated at build
time from `react-icons` by this repo's own generator, so it is not untrusted
input — but `script-src 'nonce-…'` means that even if a future icon set shipped
a `<script>` inside its SVG, it could not execute. `default-src 'none'` blocks
network access from the panel entirely.

`localResourceRoots` is limited to `media/`.

## Keyboard

The grid is fully keyboard-operable — a picker that requires the mouse would be
a downgrade from the QuickPick.

| Key | Action |
|---|---|
| Type anything | Focus returns to the search box, so refining never needs the mouse |
| `↓` from search | Enter the grid |
| `←` `→` | Previous / next icon |
| `↑` `↓` | Move a visual row; `↑` from the top row returns to the search box |
| `Home` / `End` | First / last result |
| `Enter` | Insert. From the search box with nothing selected, takes the first result |
| `Escape` | Close without inserting |

Row arithmetic is measured, not assumed: `columnCount()` counts how many cells
share the first row's `offsetTop`, so `↑`/`↓` move one visual row at whatever
width the panel happens to be and whatever the slider is set to.

## The size slider

Ranges 16–96 px, step 4. It writes `--icon-size` on `:root`, and the grid's
`grid-template-columns` is derived from that custom property, so the columns
reflow as you drag.

The value persists to `reactIcons.gridIconSize` on `change` (drag release), not
on `input` — writing a setting on every intermediate value would thrash the
configuration file. It is written to `ConfigurationTarget.Global`, because a
comfortable icon size is a property of the person, not of the workspace.

## Theming

All colour comes from VS Code CSS variables — `--vscode-editor-background`,
`--vscode-list-hoverBackground`, `--vscode-list-activeSelectionBackground`,
`--vscode-input-*`, `--vscode-focusBorder`. Nothing is hardcoded, so light, dark
and high-contrast themes all work without a theme-kind check.

This is a difference worth noting from the QuickPick and hover paths, which
*do* need an explicit `activeColorTheme.kind` check: those render SVGs outside
any theme CSS scope, so `currentColor` resolves to nothing and a literal colour
has to be baked into the SVG. Inside a webview, `currentColor` works normally.

## State

`vscode.setState({ query })` preserves the query if the panel is reloaded.
`retainContextWhenHidden` is off — the panel resolves and disposes on pick or
close, so there is no long-lived state to retain, and keeping a hidden webview
alive costs memory for no benefit.

## Testing

Neither picker is covered by `npm test`; both are UI surfaces that need a real
Extension Host. The manual checklist in
[Development](./development.md#manual-test-checklist) covers them. What *is*
tested is everything behind them — `index.search`, `resolveByName`, `getSvg`,
and the whole insert path that consumes the returned `IconRef`.
