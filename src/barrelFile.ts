import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExportDeclaration } from 'ts-morph';
import { detectQuote, withSourceFile } from './astProject';
import type { IconRef } from './iconIndex';

export type BarrelLanguage = 'ts' | 'js';

export interface BarrelLocation {
  uri: vscode.Uri;
  fsPath: string;
  language: BarrelLanguage;
  exists: boolean;
  /** Both `react-icons.ts` and `react-icons.js` are present -- `.ts` wins, user is warned. */
  ambiguous: boolean;
  workspaceFolder: vscode.WorkspaceFolder;
}

/** One `export { name as alias } from 'spec';` entry. */
interface ReExport {
  name: string;
  alias?: string;
  spec: string;
}

export interface BarrelUpdate {
  /** Full replacement text for the barrel file. */
  newText: string;
  /** False when the icon was already re-exported and nothing needs writing. */
  changed: boolean;
  /** Symbol the active file must import -- the alias when a collision forced one. */
  exportedName: string;
  /** Set that already owns this bare name, when an alias had to be introduced. */
  collisionWith?: string;
}

const HEADER = [
  '// Centralised react-icons barrel.',
  '// Generated and maintained by the "React Icons Inserter" VS Code extension.',
  '// Add icons through the picker so imports stay in sync; hand edits are preserved.',
  '',
].join('\n');

function pascal(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve (but do not create) the barrel file for the workspace that owns
 * `activeDocument`.
 *
 * Language choice, in order: the `reactIcons.language` setting, then an
 * existing barrel file, then `tsconfig.json` at the workspace root, then the
 * extension of the file being edited.
 */
export async function locateBarrel(
  activeDocument: vscode.TextDocument,
): Promise<BarrelLocation | undefined> {
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(activeDocument.uri) ?? vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  const config = vscode.workspace.getConfiguration('reactIcons', activeDocument.uri);
  const directory = config.get<string>('barrelDirectory', 'icons');
  const baseName = config.get<string>('barrelFileName', 'react-icons');
  const configured = config.get<'auto' | BarrelLanguage>('language', 'auto');

  const tsUri = vscode.Uri.joinPath(workspaceFolder.uri, directory, `${baseName}.ts`);
  const jsUri = vscode.Uri.joinPath(workspaceFolder.uri, directory, `${baseName}.js`);
  const [hasTs, hasJs] = await Promise.all([fileExists(tsUri), fileExists(jsUri)]);

  // An existing file always wins over detection -- never create the second variant.
  if (hasTs || hasJs) {
    const language: BarrelLanguage = hasTs ? 'ts' : 'js';
    return {
      uri: hasTs ? tsUri : jsUri,
      fsPath: (hasTs ? tsUri : jsUri).fsPath,
      language,
      exists: true,
      ambiguous: hasTs && hasJs,
      workspaceFolder,
    };
  }

  let language: BarrelLanguage;
  if (configured === 'ts' || configured === 'js') {
    language = configured;
  } else if (/\.tsx?$/.test(activeDocument.uri.fsPath)) {
    language = 'ts';
  } else {
    language = (await fileExists(vscode.Uri.joinPath(workspaceFolder.uri, 'tsconfig.json')))
      ? 'ts'
      : 'js';
  }

  const uri = language === 'ts' ? tsUri : jsUri;
  return {
    uri,
    fsPath: uri.fsPath,
    language,
    exists: false,
    ambiguous: false,
    workspaceFolder,
  };
}

/** True when the document being edited *is* the barrel file (self-import guard). */
export function isBarrelDocument(document: vscode.TextDocument, barrel: BarrelLocation): boolean {
  return document.uri.fsPath.toLowerCase() === barrel.fsPath.toLowerCase();
}

/**
 * Import specifier for the barrel, relative to `fromFsPath`, extension dropped
 * and separators normalised to `/` (Windows `\` is not valid in a specifier).
 */
export function barrelSpecifierFrom(fromFsPath: string, barrelFsPath: string): string {
  const withoutExtension = barrelFsPath.replace(/\.(ts|js)$/i, '');
  let relative = path.relative(path.dirname(fromFsPath), withoutExtension).split(path.sep).join('/');
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative;
}

/** Strip a leading comment banner so a regenerated barrel keeps it. */
function splitHeader(text: string): { header: string; rest: string } {
  const lines = text.split('\n');
  let index = 0;
  let inBlock = false;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (inBlock) {
      index++;
      if (line.endsWith('*/')) {
        inBlock = false;
      }
      continue;
    }
    if (line === '' || line.startsWith('//')) {
      index++;
      continue;
    }
    if (line.startsWith('/*')) {
      inBlock = !line.endsWith('*/');
      index++;
      continue;
    }
    break;
  }
  return { header: lines.slice(0, index).join('\n'), rest: lines.slice(index).join('\n') };
}

function renderReExports(entries: ReExport[], quote: string, sortBy: 'name' | 'set'): string {
  const sorted = [...entries].sort((a, b) => {
    const aName = a.alias ?? a.name;
    const bName = b.alias ?? b.name;
    if (sortBy === 'set' && a.spec !== b.spec) {
      return a.spec.localeCompare(b.spec);
    }
    return aName.localeCompare(bName);
  });
  return sorted
    .map((entry) => {
      const clause = entry.alias ? `${entry.name} as ${entry.alias}` : entry.name;
      return `export { ${clause} } from ${quote}${entry.spec}${quote};`;
    })
    .join('\n');
}

/**
 * Work out the new barrel contents needed to re-export `icon`.
 *
 * Dedupe is by `(name, source path)` -- react-icons names are unique inside a
 * set, but `fa`/`fa6`, `io`/`io5` and `hi`/`hi2` share prefixes and genuinely
 * collide (1431 duplicate names in react-icons 5.7). When a *different* set
 * already owns the bare name, neither entry is dropped: the newcomer is
 * re-exported under an alias (`FaBeer` from `fa6` becomes `FaBeerFa6`) and the
 * caller surfaces a warning so the user can rename it if they prefer.
 */
export function planBarrelUpdate(
  barrel: BarrelLocation,
  currentText: string,
  icon: IconRef,
  sortBy: 'name' | 'set',
): BarrelUpdate {
  const text = currentText.length > 0 ? currentText : HEADER;
  const quote = detectQuote(text);

  return withSourceFile(barrel.fsPath, text, (sourceFile): BarrelUpdate => {
    const declarations = sourceFile.getExportDeclarations();
    const entries: ReExport[] = [];
    for (const declaration of declarations) {
      const spec = declaration.getModuleSpecifierValue();
      if (!spec) {
        continue;
      }
      for (const named of declaration.getNamedExports()) {
        entries.push({
          name: named.getName(),
          alias: named.getAliasNode()?.getText(),
          spec,
        });
      }
    }

    // Already re-exported from the very same set: nothing to do.
    const existing = entries.find((entry) => entry.name === icon.name && entry.spec === icon.modulePath);
    if (existing) {
      return {
        newText: currentText,
        changed: false,
        exportedName: existing.alias ?? existing.name,
      };
    }

    const taken = new Set(entries.map((entry) => entry.alias ?? entry.name));
    let alias: string | undefined;
    let collisionWith: string | undefined;
    if (taken.has(icon.name)) {
      const owner = entries.find((entry) => (entry.alias ?? entry.name) === icon.name);
      collisionWith = owner?.spec;
      let candidate = `${icon.name}${pascal(icon.set)}`;
      let counter = 2;
      while (taken.has(candidate)) {
        candidate = `${icon.name}${pascal(icon.set)}${counter++}`;
      }
      alias = candidate;
    }

    const added: ReExport = { name: icon.name, alias, spec: icon.modulePath };
    const exportedName = alias ?? icon.name;

    // Regenerating sorted output is only safe when the file is nothing but
    // re-exports. Anything else (a hand-written helper, `export *`, a type
    // alias) means we append in place and leave the user's ordering alone.
    const isPureBarrel = sourceFile
      .getStatements()
      .every(
        (statement) =>
          // getKindName() avoids importing SyntaxKind as a *value*, which would
          // drag ts-morph into the module graph at load time.
          statement.getKindName() === 'ExportDeclaration' &&
          Boolean((statement as ExportDeclaration).getModuleSpecifierValue()),
      );

    if (isPureBarrel) {
      const { header } = splitHeader(text);
      const banner = header.trim().length > 0 ? `${header.replace(/\s+$/, '')}\n\n` : HEADER + '\n';
      return {
        newText: `${banner}${renderReExports([...entries, added], quote, sortBy)}\n`,
        changed: true,
        exportedName,
        collisionWith,
      };
    }

    sourceFile.addExportDeclaration({
      moduleSpecifier: icon.modulePath,
      namedExports: [alias ? { name: icon.name, alias } : { name: icon.name }],
    });
    return {
      newText: sourceFile.getFullText(),
      changed: true,
      exportedName,
      collisionWith,
    };
  });
}
