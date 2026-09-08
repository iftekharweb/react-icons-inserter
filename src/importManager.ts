import * as path from 'node:path';
import * as vscode from 'vscode';
import { detectQuote, withSourceFile } from './astProject';
import {
  BarrelLocation,
  barrelSpecifierFrom,
  isBarrelDocument,
  locateBarrel,
  planBarrelUpdate,
} from './barrelFile';
import { ensureReactIconsDependency } from './dependencyCheck';
import type { IconRef } from './iconIndex';

/** An offset-based text edit against the document's *original* content. */
export interface TextEditSpec {
  start: number;
  end: number;
  newText: string;
}

/** Strip a JS/TS extension so `./x`, `./x.ts` and `./x.tsx` compare equal. */
function stripExtension(value: string): string {
  return value.replace(/\.(m|c)?(t|j)sx?$/i, '');
}

/**
 * Does `specifier`, written inside `fromFsPath`, point at the barrel file?
 * Resolved by path rather than string equality so `../icons/react-icons`,
 * `../icons/react-icons.ts` and `../../app/../icons/react-icons` all match.
 * Non-relative specifiers (bare imports, `@/` aliases) can only match on the
 * exact string we would have generated -- resolving tsconfig `paths` is out of
 * scope, and guessing wrong would produce a duplicate import.
 */
export function specifierPointsAtBarrel(
  fromFsPath: string,
  specifier: string,
  barrelFsPath: string,
): boolean {
  if (!specifier.startsWith('.')) {
    return false;
  }
  const resolved = stripExtension(path.resolve(path.dirname(fromFsPath), specifier));
  const target = stripExtension(barrelFsPath);
  return resolved.toLowerCase() === target.toLowerCase();
}

/**
 * Plan the edit that makes `localName` available in `text` as a named import
 * from `specifier`.
 *
 * Returns `undefined` when the name is already imported. Otherwise a single
 * minimal edit -- either a rewrite of the existing import declaration (merging
 * the new specifier into its named-import list) or an insertion of one new
 * import line. Minimal edits are used instead of a whole-file replacement so
 * the caret, selection and folding state in the active editor survive.
 */
export function planNamedImport(
  filePath: string,
  text: string,
  localName: string,
  specifier: string,
  barrelFsPath: string,
): TextEditSpec | undefined {
  const quote = detectQuote(text);

  return withSourceFile(filePath, text, (sourceFile): TextEditSpec | undefined => {
    const imports = sourceFile.getImportDeclarations();

    const existing = imports.find((declaration) => {
      const value = declaration.getModuleSpecifierValue();
      return value === specifier || specifierPointsAtBarrel(filePath, value, barrelFsPath);
    });

    if (existing) {
      const alreadyImported = existing
        .getNamedImports()
        .some((named) => (named.getAliasNode()?.getText() ?? named.getName()) === localName);
      if (alreadyImported) {
        return undefined;
      }
      // Capture the range BEFORE mutating: addNamedImport rewrites the source
      // file, so the node's positions afterwards refer to the *new* text, while
      // the edit has to be expressed against the original.
      const start = existing.getStart();
      const end = existing.getEnd();
      // A default-only or namespace import from the barrel is not something we
      // generate, but merging into it is still correct: addNamedImport keeps
      // the default clause intact.
      existing.addNamedImport(localName);
      return { start, end, newText: existing.getText() };
    }

    const line = `import { ${localName} } from ${quote}${specifier}${quote};`;
    const lastImport = imports[imports.length - 1];
    if (lastImport) {
      return { start: lastImport.getEnd(), end: lastImport.getEnd(), newText: `\n${line}` };
    }

    // No imports at all: go after any directive prologue ("use client", "use
    // strict") and after leading comments, but before the first real statement.
    const statements = sourceFile.getStatements();
    let anchor = statements[0];
    while (anchor && isDirective(anchor.getText())) {
      anchor = statements[statements.indexOf(anchor) + 1];
    }
    if (!anchor) {
      const previous = statements[statements.length - 1];
      const offset = previous ? previous.getEnd() : text.length;
      return { start: offset, end: offset, newText: previous ? `\n${line}\n` : `${line}\n` };
    }
    // getStart() skips leading trivia, so comments above the statement stay put.
    return { start: anchor.getStart(), end: anchor.getStart(), newText: `${line}\n\n` };
  });
}

function isDirective(statementText: string): boolean {
  return /^(['"])use [a-z ]+\1;?$/.test(statementText.trim());
}

export interface InsertOptions {
  /** Replace this range instead of inserting at the caret (used by "change icon"). */
  replaceRange?: vscode.Range;
  /** Skip the JSX write entirely and only maintain barrel + import. */
  skipJsx?: boolean;
  /** Write the bare identifier instead of a `<Name />` element (icon swap). */
  identifierOnly?: boolean;
}

export interface InsertResult {
  inserted: boolean;
  exportedName: string;
  barrel: BarrelLocation;
  createdBarrel: boolean;
  collisionWith?: string;
}

/**
 * Insert `icon` into the active editor and keep both the barrel file and the
 * active file's imports in sync.
 *
 * ATOMICITY
 * ---------
 * Every write -- the JSX text, the active file's import, the barrel's
 * re-export, and the creation of the barrel file itself -- goes into one
 * `vscode.WorkspaceEdit` applied with a single `applyEdit()` call, so the
 * operation either lands completely or not at all.
 *
 * Undo is a different matter, and worth being honest about: VS Code keeps a
 * separate undo stack per document. Ctrl+Z in the editor undoes the JSX and the
 * import together (same document, same edit), but it does NOT roll back the
 * barrel file -- that needs its own undo in that file's editor. There is no API
 * to join undo stacks across documents; this is a platform limitation, not
 * something the extension can paper over.
 */
export async function insertIcon(
  editor: vscode.TextEditor,
  icon: IconRef,
  options: InsertOptions = {},
): Promise<InsertResult | undefined> {
  const document = editor.document;
  const barrel = await locateBarrel(document);
  if (!barrel) {
    void vscode.window.showErrorMessage(
      'React Icons Inserter needs an open workspace folder to place the icon barrel file.',
    );
    return undefined;
  }

  if (barrel.ambiguous) {
    void vscode.window.showWarningMessage(
      `Both ${path.basename(barrel.fsPath, '.ts')}.ts and .js exist in the barrel folder. ` +
        'Using the .ts file; delete the other to remove the ambiguity.',
    );
  }

  const config = vscode.workspace.getConfiguration('reactIcons', document.uri);
  const sortBy = config.get<'name' | 'set'>('sortBarrelExports', 'set');

  // Read through the text-document layer so unsaved edits to the barrel are
  // respected, and so the edit below targets a document VS Code already tracks.
  let barrelDocument: vscode.TextDocument | undefined;
  let barrelText = '';
  if (barrel.exists) {
    barrelDocument = await vscode.workspace.openTextDocument(barrel.uri);
    barrelText = barrelDocument.getText();
  }

  const plan = planBarrelUpdate(barrel, barrelText, icon, sortBy);

  const edit = new vscode.WorkspaceEdit();

  if (!barrel.exists) {
    edit.createFile(barrel.uri, {
      ignoreIfExists: true,
      contents: Buffer.from(plan.newText, 'utf8'),
    });
  } else if (plan.changed && barrelDocument) {
    const whole = new vscode.Range(
      barrelDocument.positionAt(0),
      barrelDocument.positionAt(barrelText.length),
    );
    edit.replace(barrel.uri, whole, plan.newText);
  }

  const editingBarrelItself = isBarrelDocument(document, barrel);

  // Active-document edits are collected first so an overlap can be resolved
  // before anything is committed -- a WorkspaceEdit with overlapping ranges in
  // one document is rejected wholesale.
  const documentEdits: vscode.TextEdit[] = [];
  const jsxRange = options.replaceRange ?? editor.selection;
  let inserted = false;

  // Editing the barrel itself: adding the re-export *is* the whole operation.
  // There is no JSX to write and no import to add, and a caret insert would
  // collide with the whole-file rewrite below.
  if (!options.skipJsx && !editingBarrelItself) {
    const replacement = options.identifierOnly
      ? plan.exportedName
      : `<${plan.exportedName} />`;
    documentEdits.push(vscode.TextEdit.replace(jsxRange, replacement));
    inserted = true;
  }

  // Self-import guard: when the user runs the picker from inside the barrel
  // file, adding the re-export is the whole job -- importing from itself would
  // be a cycle.
  if (!editingBarrelItself) {
    const specifier = barrelSpecifierFrom(document.uri.fsPath, barrel.fsPath);
    const importEdit = planNamedImport(
      document.uri.fsPath,
      document.getText(),
      plan.exportedName,
      specifier,
      barrel.fsPath,
    );
    if (importEdit) {
      const range = new vscode.Range(
        document.positionAt(importEdit.start),
        document.positionAt(importEdit.end),
      );
      if (inserted && range.intersection(jsxRange)) {
        // Pathological: the caret sits inside the import statement being
        // rewritten. Drop the JSX write rather than corrupt the file.
        void vscode.window.showWarningMessage(
          'Cursor is inside the import statement being updated; added the import only.',
        );
        documentEdits.length = 0;
        inserted = false;
      }
      documentEdits.push(vscode.TextEdit.replace(range, importEdit.newText));
    }
  }

  if (documentEdits.length > 0) {
    edit.set(document.uri, documentEdits);
  }

  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    void vscode.window.showErrorMessage(`Could not insert ${icon.name}.`);
    return undefined;
  }

  // Persist the barrel so a file the user never opened does not linger dirty.
  const savedBarrel = await vscode.workspace.openTextDocument(barrel.uri);
  if (savedBarrel.isDirty) {
    await savedBarrel.save();
  }

  if (plan.collisionWith) {
    void vscode.window.showWarningMessage(
      `${icon.name} is already re-exported from ${plan.collisionWith}. ` +
        `Added it as ${plan.exportedName} instead -- rename either export if you prefer.`,
    );
  }

  void ensureReactIconsDependency(barrel.workspaceFolder, document.uri);

  return {
    inserted,
    exportedName: plan.exportedName,
    barrel,
    createdBarrel: !barrel.exists,
    collisionWith: plan.collisionWith,
  };
}
