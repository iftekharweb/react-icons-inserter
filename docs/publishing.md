# Publishing

Reference: [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

Two things must exist before the first publish, and only a human can create
them: an **Azure DevOps Personal Access Token** and a **Marketplace publisher**.
Everything else in this repo is already prepared.

## One-time setup

### 1. Azure DevOps organisation

Sign in at <https://dev.azure.com> with the Microsoft account you want to own
the publisher. Any organisation will do; it exists only to issue the token.

### 2. Personal Access Token

**User settings** (top right) → **Personal access tokens** → **New Token**.

| Field | Value |
|---|---|
| Organization | **All accessible organizations** — required, a single-org token fails |
| Expiration | up to 1 year |
| Scopes | **Custom defined** → **Marketplace** → **Manage** |

Copy the token once; it is not shown again.

> Do not paste the token into a chat, a commit, or a CI log. Store it in a
> password manager. `vsce login` keeps it in the OS keychain.

### 3. Create the publisher

<https://marketplace.visualstudio.com/manage> → **Create publisher**. The **ID**
is permanent and appears in the extension's URL and in
`code --install-extension <publisher>.react-icons-inserter`.

### 4. Point the manifest at it

`package.json` currently carries a placeholder:

```json
"publisher": "react-icons-inserter"
```

Replace it with your publisher ID. The publish fails otherwise.

### 5. Log in

```bash
npx vsce login <your-publisher-id>
```

Paste the PAT at the prompt. It is stored in the OS keychain, so later
publishes need no token. Run this in your own terminal — it is interactive.

## Publishing

```bash
npm run compile     # typecheck
npm test            # 23 assertions
npm run package     # regenerates the index, builds, writes the .vsix
npx vsce publish
```

`vsce publish` runs `vscode:prepublish` itself, so the explicit `package` step
is only there to let you inspect the `.vsix` first. The listing goes live within
a few minutes; the Marketplace validates in the background and emails on
failure.

Version bumps can be delegated:

```bash
npx vsce publish patch      # 0.2.0 -> 0.2.1, commits and tags
npx vsce publish minor      # 0.2.0 -> 0.3.0
```

These write to `package.json` and create a git commit and tag, so run them on a
clean tree.

### CI

Set `VSCE_PAT` as a secret and call `npx vsce publish` — it reads the token from
the environment, so no `vsce login` is needed. Never echo the variable.

## Pre-publish checklist

Everything unticked here is prepared already; the first three are yours.

- [ ] `publisher` in `package.json` is your real publisher ID, not the
      placeholder.
- [ ] PAT created with **Marketplace → Manage** on **all accessible
      organizations**.
- [ ] `npx vsce login <publisher>` succeeded.
- [ ] **Licensing settled** — see below. This is the one item that is hard to
      undo once the extension is public.
- [x] `LICENSE` present, `license` field set.
- [x] `repository`, `homepage`, `bugs` set.
- [x] `icon` — 128×128 PNG at `media/icon.png`, regenerate with
      `npm run generate-branding`.
- [x] README images — absolute `raw.githubusercontent.com` URLs, regenerate with
      `npm run generate-screenshots`.
- [x] `galleryBanner` colour matches the icon background.
- [x] `categories` are real Marketplace categories (`Snippets`, `Other`).
- [x] `extensionKind: ["workspace"]` — the extension is Node-based and resolves
      workspace files by `fsPath`, so it must run where the files are.
- [x] `CHANGELOG.md` present; the Marketplace renders it as its own tab.
- [x] README opens with what the extension does, and every relative link
      resolves against `repository` on the Marketplace page.
- [x] `.vsix` contains only what it should — verify with `npx vsce ls`.

## Licensing: settle this first

The extension redistributes SVG artwork for all 31 sets. `react-icons` is MIT;
**the artwork is not**. Publishing is a distribution, so each set's terms apply.

- **Font Awesome 5 & 6** (3,669 icons) — CC BY 4.0. Requires attribution.
- **Circum Icons** (288 icons) — MPL-2.0, file-level copyleft.

The README carries an **Attribution** section that satisfies CC BY, and it is
the text the Marketplace renders on the extension page. Keep it there.

If you would rather not carry those obligations, drop the sets — a one-line
filter in `scripts/generate-icon-index.ts`, then regenerate. Details and the
exact procedure in [Licensing](./licensing.md).

## What the Marketplace shows

| Surface | Comes from |
|---|---|
| Tile icon | `icon` → `media/icon.png` |
| Banner colour | `galleryBanner.color` |
| Title / subtitle | `displayName`, `description` |
| Details tab | `README.md`, rendered from the packaged copy |
| Changelog tab | `CHANGELOG.md` |
| Search terms | `keywords` (first 5), `displayName`, `description` |
| Q&A tab | `qna: "marketplace"` |

Relative links in the README resolve against `repository`. Images need absolute
URLs, or `vsce package --baseImagesUrl` — the README's two picker images already
use `raw.githubusercontent.com`, so they render on the listing without shipping
inside the `.vsix`.

Those images are **generated, not captured**: `npm run generate-screenshots`
composes them from `media/picker.css`'s metrics, VS Code Dark Modern's palette
and real `IconIndex` results. That keeps them from drifting when the picker
changes, and it is why they can be regenerated in CI. They are accurate to the
layout but not to VS Code's own font rasterisation or window chrome — swap in
real captures if you want the listing to show the genuine article. A hover
preview image is still missing.

## After publishing

```bash
code --install-extension <publisher>.react-icons-inserter
```

Then tag the release and attach the `.vsix` to GitHub, matching what was done
for v0.1.0:

```bash
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
gh release create v0.2.0 react-icons-inserter-0.2.0.vsix \
  --title "v0.2.0" --notes-file <notes>
```

Unpublishing is possible (`vsce unpublish <publisher>.react-icons-inserter`) but
removes the extension and its install base permanently. Prefer publishing a fix.

## Alternative: skip the Marketplace

The `.vsix` on the GitHub release already installs fine:

```bash
code --install-extension react-icons-inserter-0.2.0.vsix
```

Reasonable if you want the extension usable without settling the artwork
licensing for public distribution. It gets no auto-updates and no discovery.

Open VSX (<https://open-vsx.org>) is the third option — the registry VSCodium
and Gitpod use. Same `.vsix`, published with `npx ovsx publish`, separate token.
