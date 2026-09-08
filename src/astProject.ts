import * as path from 'node:path';
import type { SourceFile } from 'ts-morph';

/**
 * Deferred entry point to the `ts-morph` layer.
 *
 * WHY THIS INDIRECTION EXISTS
 * ---------------------------
 * `ts-morph` embeds the whole TypeScript compiler. Bundled into
 * `dist/extension.js` it costs ~320 ms of module evaluation *at require time* --
 * before `activate()` even runs -- and every user who opens a `.js` file pays
 * it, whether or not they ever insert an icon. A lazy `require()` inside the
 * same bundle does not help: esbuild hoists ESM module initialisation to the
 * top of the output regardless.
 *
 * So the AST layer is built as a **second bundle**, `dist/astWorker.js`, and
 * loaded through a non-literal `require()` that esbuild leaves as a real
 * runtime call. The TypeScript compiler is then only parsed and initialised on
 * the first AST operation -- the first icon insert or the first hover over a
 * barrel import -- which is a user action, not startup.
 *
 * Everything here is a thin pass-through; the real implementation lives in
 * `astWorker.ts`.
 */
type AstWorker = typeof import('./astWorker');

let worker: AstWorker | undefined;

function load(): AstWorker {
  if (!worker) {
    // Non-literal specifier on purpose: a literal would let esbuild inline the
    // worker back into the main bundle and undo the deferral.
    const bundled = path.join(__dirname, 'astWorker.js');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      worker = require(bundled) as AstWorker;
    } catch {
      // Running from source (ts-node/tsx, e.g. in tests): no built worker yet.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      worker = require(path.join(__dirname, 'astWorker')) as AstWorker;
    }
  }
  return worker;
}

/** Parse `text` as `filePath` and hand the AST to `work`. See `astWorker.ts`. */
export function withSourceFile<T>(
  filePath: string,
  text: string,
  work: (sourceFile: SourceFile) => T,
): T {
  return load().withSourceFile(filePath, text, work);
}

/** Single or double quotes, whichever the file already prefers. */
export function detectQuote(text: string): '"' | "'" {
  const single = (text.match(/from '/g) ?? []).length;
  const double = (text.match(/from "/g) ?? []).length;
  return double > single ? '"' : "'";
}

/** Releases the shared Project. A no-op if the worker was never loaded. */
export function disposeProject(): void {
  worker?.disposeProject();
}
