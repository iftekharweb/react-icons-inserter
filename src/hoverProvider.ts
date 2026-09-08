import * as vscode from 'vscode';
import { withSourceFile } from './astProject';
import { barrelSpecifierFrom, isBarrelDocument, locateBarrel } from './barrelFile';
import { specifierPointsAtBarrel } from './importManager';
import type { IconIndex, IconRef } from './iconIndex';

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/;

/** `export { FaBeer as FaBeerFa6 } from 'react-icons/fa6'` -> exported name -> origin. */
interface BarrelExport {
  originalName: string;
  modulePath: string;
}

/** Cache entry keyed by `uri|version`, so an unedited document is parsed once. */
interface Cached<T> {
  key: string;
  value: T;
}

/**
 * Hover previews for icons that came from the centralised barrel.
 *
 * CORRECTNESS OVER PATTERN MATCHING
 * ---------------------------------
 * Matching any capitalised identifier against the icon name list produces
 * constant false positives -- plenty of projects have a component literally
 * called `Menu`, `Home` or `Search`. So a hover only renders when all of this
 * holds:
 *   1. the hovered identifier is a *named import* in this file,
 *   2. that import's specifier resolves, on disk, to the workspace barrel file,
 *   3. the barrel actually re-exports that name from a `react-icons/<set>` path.
 * Step 3 also recovers the original icon behind an alias, so `FaBeerFa6`
 * (created by the fa/fa6 collision rule) still previews correctly.
 *
 * COST
 * ----
 * Two AST parses per hover in the worst case, both cached by document version:
 * hovering the same file repeatedly re-parses nothing. The SVG payload for the
 * set is fetched lazily and cached for the session by `IconIndex`.
 */
export class IconHoverProvider implements vscode.HoverProvider {
  private importCache?: Cached<Map<string, string>>;
  private barrelCache?: Cached<Map<string, BarrelExport>>;

  constructor(private readonly index: IconIndex) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    if (!vscode.workspace.getConfiguration('reactIcons', document.uri).get<boolean>('enableHoverPreview', true)) {
      return undefined;
    }

    const wordRange = document.getWordRangeAtPosition(position, IDENTIFIER);
    if (!wordRange) {
      return undefined;
    }
    const word = document.getText(wordRange);
    // Every react-icons export is PascalCase; bail before any I/O otherwise.
    if (word.length < 3 || !/^[A-Z]/.test(word)) {
      return undefined;
    }

    const barrel = await locateBarrel(document);
    if (!barrel?.exists || token.isCancellationRequested) {
      return undefined;
    }

    const editingBarrel = isBarrelDocument(document, barrel);
    if (!editingBarrel) {
      const imports = this.readImports(document, barrel.fsPath);
      const specifier = imports.get(word);
      if (!specifier) {
        return undefined;
      }
    }

    const barrelDocument = await vscode.workspace.openTextDocument(barrel.uri);
    if (token.isCancellationRequested) {
      return undefined;
    }
    const exported = this.readBarrelExports(barrelDocument).get(word);
    if (!exported || !exported.modulePath.startsWith('react-icons/')) {
      return undefined;
    }

    await this.index.load();
    if (token.isCancellationRequested) {
      return undefined;
    }

    const setId = exported.modulePath.slice('react-icons/'.length);
    const icon = this.index
      .resolveByName(exported.originalName)
      .find((candidate) => candidate.set === setId);
    if (!icon) {
      return undefined;
    }

    const markdown = await this.renderHover(icon, word, document, barrel.fsPath, wordRange);
    if (!markdown || token.isCancellationRequested) {
      return undefined;
    }
    return new vscode.Hover(markdown, wordRange);
  }

  private async renderHover(
    icon: IconRef,
    localName: string,
    document: vscode.TextDocument,
    barrelFsPath: string,
    range: vscode.Range,
  ): Promise<vscode.MarkdownString | undefined> {
    // A base64 data URI in markdown image syntax is the one form VS Code's
    // hover renderer accepts reliably across stable builds; an <img> tag needs
    // supportHtml and is still sanitised on some themes. Size is baked into the
    // SVG's own width/height because the `|width=` markdown hint is not
    // universally honoured in hovers.
    const light = await this.index.getDataUri(icon, 56, '#3b3b3b');
    const dark = await this.index.getDataUri(icon, 56, '#cccccc');
    const isLight =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight;
    const dataUri = isLight ? light : dark;
    if (!dataUri) {
      return undefined;
    }

    const markdown = new vscode.MarkdownString();
    // Trusted only for this extension's own command -- never blanket `true`.
    markdown.isTrusted = { enabledCommands: ['reactIcons.replaceAtCursor'] };
    markdown.supportThemeIcons = true;

    markdown.appendMarkdown(`![${icon.name}](${dataUri})\n\n`);
    markdown.appendMarkdown(`**${localName}**`);
    if (localName !== icon.name) {
      markdown.appendMarkdown(` &nbsp;·&nbsp; alias of \`${icon.name}\``);
    }
    markdown.appendMarkdown(`\n\n${icon.setLabel} &nbsp;·&nbsp; \`${icon.modulePath}\`\n\n`);
    markdown.appendMarkdown(
      `Imported from \`${barrelSpecifierFrom(document.uri.fsPath, barrelFsPath)}\`\n\n`,
    );

    const args = encodeURIComponent(
      JSON.stringify([document.uri.toString(), range.start.line, range.start.character]),
    );
    markdown.appendMarkdown(`[$(replace) Change icon](command:reactIcons.replaceAtCursor?${args})`);
    return markdown;
  }

  /** Local import name -> module specifier, for imports that hit the barrel. */
  private readImports(document: vscode.TextDocument, barrelFsPath: string): Map<string, string> {
    const key = `${document.uri.toString()}|${document.version}`;
    if (this.importCache?.key === key) {
      return this.importCache.value;
    }
    const filePath = document.uri.fsPath;
    const value = withSourceFile(filePath, document.getText(), (sourceFile) => {
      const map = new Map<string, string>();
      for (const declaration of sourceFile.getImportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        if (!specifierPointsAtBarrel(filePath, specifier, barrelFsPath)) {
          continue;
        }
        for (const named of declaration.getNamedImports()) {
          map.set(named.getAliasNode()?.getText() ?? named.getName(), specifier);
        }
      }
      return map;
    });
    this.importCache = { key, value };
    return value;
  }

  /** Exported name (alias if present) -> original name + react-icons module. */
  private readBarrelExports(document: vscode.TextDocument): Map<string, BarrelExport> {
    const key = `${document.uri.toString()}|${document.version}`;
    if (this.barrelCache?.key === key) {
      return this.barrelCache.value;
    }
    const value = withSourceFile(document.uri.fsPath, document.getText(), (sourceFile) => {
      const map = new Map<string, BarrelExport>();
      for (const declaration of sourceFile.getExportDeclarations()) {
        const modulePath = declaration.getModuleSpecifierValue();
        if (!modulePath) {
          continue;
        }
        for (const named of declaration.getNamedExports()) {
          const originalName = named.getName();
          const exportedName = named.getAliasNode()?.getText() ?? originalName;
          map.set(exportedName, { originalName, modulePath });
        }
      }
      return map;
    });
    this.barrelCache = { key, value };
    return value;
  }
}
