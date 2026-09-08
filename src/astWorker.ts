import { Project, QuoteKind, ScriptKind, SourceFile, ts } from 'ts-morph';

/**
 * The `ts-morph` layer. Built as its own bundle (`dist/astWorker.js`) and
 * required on demand by `astProject.ts`, so the TypeScript compiler it embeds
 * is never initialised during extension startup. See `astProject.ts` for why.
 *
 * WHY A SINGLETON
 * ---------------
 * Constructing a `Project` allocates a full TypeScript LanguageService and
 * compiler host. One instance is created on first use and reused for the life
 * of the extension host; source files are added and immediately removed again,
 * so nothing accumulates.
 *
 * The virtual file system means we never touch disk here -- text always comes
 * from a `vscode.TextDocument` (so unsaved editor state is respected) and goes
 * back out as a `WorkspaceEdit`.
 */
let project: Project | undefined;

function getProject(): Project {
  if (!project) {
    project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      manipulationSettings: {
        quoteKind: QuoteKind.Single,
      },
      compilerOptions: {
        // JSX must be enabled or every .tsx/.jsx file fails to parse.
        jsx: ts.JsxEmit.ReactJSX,
        allowJs: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
    });
  }
  return project;
}

function scriptKindFor(filePath: string): ScriptKind {
  if (filePath.endsWith('.tsx')) {
    return ScriptKind.TSX;
  }
  if (filePath.endsWith('.jsx')) {
    return ScriptKind.JSX;
  }
  if (/\.(m|c)?js$/.test(filePath)) {
    return ScriptKind.JS;
  }
  return ScriptKind.TS;
}

/**
 * Parse `text` as `filePath`, hand the AST to `work`, then always drop the
 * source file again so the shared project stays empty between operations.
 */
export function withSourceFile<T>(
  filePath: string,
  text: string,
  work: (sourceFile: SourceFile) => T,
): T {
  const proj = getProject();
  // Normalise to a POSIX-ish virtual path: ts-morph's in-memory FS is
  // case-sensitive and does not understand Windows drive letters.
  const virtualPath = `/virtual/${filePath.replace(/[\\/:]+/g, '_')}`;
  const sourceFile = proj.createSourceFile(virtualPath, text, {
    overwrite: true,
    scriptKind: scriptKindFor(filePath),
  });
  try {
    return work(sourceFile);
  } finally {
    proj.removeSourceFile(sourceFile);
  }
}

export function disposeProject(): void {
  project = undefined;
}
