/**
 * A minimal in-memory `vscode` module plus a fake workspace filesystem.
 *
 * The extension has no dependency on the VS Code test runner, and spinning up a
 * real Extension Host to assert on generated text would be slow and awkward to
 * run in CI. Instead the modules under test are loaded with `vscode` resolved to
 * this stub, and `WorkspaceEdit` operations are captured and replayed against a
 * `Map` of file contents -- so the assertions are about the exact text the
 * extension would have written to disk.
 */
import Module from 'node:module';
import * as path from 'node:path';

export const files = new Map<string, string>();
export const messages: string[] = [];
export let appliedOps: AnyOp[] = [];

export interface AnyOp {
  kind: 'create' | 'replace' | 'set';
  uri: { fsPath: string };
  opts?: { contents: Uint8Array };
  range?: VRange;
  newText?: string;
  edits?: { range: VRange; newText: string }[];
}

const ROOT = 'C:\\proj';

/** Case- and separator-insensitive key for the fake filesystem. */
export function norm(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

export class VPosition {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export class VRange {
  constructor(
    public start: VPosition,
    public end: VPosition,
  ) {}
  intersection(other: VRange): VRange | undefined {
    const cmp = (p: VPosition, q: VPosition): number =>
      p.line - q.line || p.character - q.character;
    const start = cmp(this.start, other.start) > 0 ? this.start : other.start;
    const end = cmp(this.end, other.end) < 0 ? this.end : other.end;
    return cmp(start, end) <= 0 ? new VRange(start, end) : undefined;
  }
}

export function makeDocument(fsPath: string) {
  const text = files.get(norm(fsPath)) ?? '';
  const offsetAt = (p: VPosition): number => {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < p.line; i++) {
      offset += lines[i].length + 1;
    }
    return offset + p.character;
  };
  const positionAt = (offset: number): VPosition => {
    const before = text.slice(0, offset).split('\n');
    return new VPosition(before.length - 1, before[before.length - 1].length);
  };
  return {
    uri: { fsPath, toString: () => 'file:///' + fsPath.replace(/\\/g, '/') },
    version: 1,
    isDirty: false,
    languageId: fsPath.endsWith('.tsx') ? 'typescriptreact' : 'typescript',
    getText: (range?: VRange) =>
      range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text,
    positionAt,
    offsetAt,
    save: async () => true,
    getWordRangeAtPosition(position: VPosition, pattern: RegExp): VRange | undefined {
      const line = text.split('\n')[position.line] ?? '';
      for (const match of line.matchAll(new RegExp(pattern.source, 'g'))) {
        const start = match.index ?? 0;
        if (position.character >= start && position.character <= start + match[0].length) {
          return new VRange(
            new VPosition(position.line, start),
            new VPosition(position.line, start + match[0].length),
          );
        }
      }
      return undefined;
    },
  };
}

export type VDocument = ReturnType<typeof makeDocument>;

const folder = {
  uri: { fsPath: ROOT, toString: () => 'file:///c:/proj' },
  name: 'proj',
  index: 0,
};

export const vscodeStub = {
  Position: VPosition,
  Range: VRange,
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => {
      const joined = path.win32.join(base.fsPath, ...parts);
      return { fsPath: joined, toString: () => 'file:///' + joined.replace(/\\/g, '/') };
    },
    parse: (value: string) => ({ toString: () => value }),
  },
  TextEdit: {
    replace: (range: VRange, newText: string) => ({ range, newText }),
  },
  WorkspaceEdit: class {
    ops: AnyOp[] = [];
    createFile(uri: { fsPath: string }, opts: { contents: Uint8Array }): void {
      this.ops.push({ kind: 'create', uri, opts });
    }
    replace(uri: { fsPath: string }, range: VRange, newText: string): void {
      this.ops.push({ kind: 'replace', uri, range, newText });
    }
    set(uri: { fsPath: string }, edits: { range: VRange; newText: string }[]): void {
      this.ops.push({ kind: 'set', uri, edits });
    }
  },
  MarkdownString: class {
    value = '';
    isTrusted: unknown = false;
    supportThemeIcons = false;
    appendMarkdown(v: string): this {
      this.value += v;
      return this;
    }
  },
  Hover: class {
    constructor(
      public contents: unknown,
      public range: unknown,
    ) {}
  },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  window: {
    activeColorTheme: { kind: 2 },
    showWarningMessage: async (m: string) => void messages.push('warn: ' + m),
    showErrorMessage: async (m: string) => void messages.push('error: ' + m),
    showInformationMessage: async (m: string) => void messages.push('info: ' + m),
    createTerminal: () => ({ show() {}, sendText() {} }),
  },
  workspace: {
    workspaceFolders: [folder],
    getWorkspaceFolder: () => folder,
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    openTextDocument: async (uri: { fsPath: string }) => makeDocument(uri.fsPath),
    applyEdit: async (edit: { ops: AnyOp[] }) => {
      appliedOps.push(...edit.ops);
      return true;
    },
    asRelativePath: (u: { fsPath?: string }) => String(u.fsPath ?? u),
    fs: {
      stat: async (uri: { fsPath: string }) => {
        if (!files.has(norm(uri.fsPath))) {
          throw new Error('ENOENT');
        }
        return {};
      },
      readFile: async (uri: { fsPath: string }) => {
        const content = files.get(norm(uri.fsPath));
        if (content === undefined) {
          throw new Error('ENOENT');
        }
        return Buffer.from(content, 'utf8');
      },
    },
  },
};

/** Must be called before any module that imports `vscode` is required. */
export function installVscodeStub(): void {
  const resolve = (Module as unknown as { _resolveFilename: Function })._resolveFilename;
  (Module as unknown as { _resolveFilename: Function })._resolveFilename = function (
    request: string,
    ...args: unknown[]
  ) {
    return request === 'vscode' ? 'vscode-stub' : resolve.call(this, request, ...args);
  };
  require.cache['vscode-stub'] = {
    id: 'vscode-stub',
    filename: 'vscode-stub',
    loaded: true,
    exports: vscodeStub,
  } as unknown as NodeModule;
}

/** Replay every captured WorkspaceEdit op against the fake filesystem. */
export function commit(): void {
  for (const op of appliedOps) {
    const target = norm(op.uri.fsPath);
    if (op.kind === 'create') {
      files.set(target, Buffer.from(op.opts!.contents).toString('utf8'));
    } else if (op.kind === 'replace') {
      files.set(target, op.newText!);
    } else if (op.kind === 'set') {
      const document = makeDocument(op.uri.fsPath);
      let text = document.getText();
      // Back-to-front, so earlier offsets stay valid as we splice.
      const ordered = [...op.edits!].sort(
        (a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start),
      );
      for (const e of ordered) {
        text =
          text.slice(0, document.offsetAt(e.range.start)) +
          e.newText +
          text.slice(document.offsetAt(e.range.end));
      }
      files.set(target, text);
    }
  }
  appliedOps = [];
}

/** A fake `TextEditor` with the caret at `caretOffset`. */
export function editorFor(fsPath: string, caretOffset: number) {
  const document = makeDocument(fsPath);
  const position = document.positionAt(caretOffset);
  return { document, selection: new VRange(position, position) };
}

export function reset(): void {
  files.clear();
  messages.length = 0;
  appliedOps = [];
}
