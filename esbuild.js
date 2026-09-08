const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Reports build failures in the format the VS Code problem matcher expects. */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[build] started'));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log('[build] finished');
    });
  },
};

async function main() {
  const context = await esbuild.context({
    // Two bundles on purpose. `astWorker` carries ts-morph (and with it the
    // TypeScript compiler, ~5.5 MB and ~320 ms of module init); keeping it out
    // of `extension.js` means that cost is only paid on the first AST edit,
    // not when VS Code loads the extension. See src/astProject.ts.
    entryPoints: ['src/extension.ts', 'src/astWorker.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    // Matches the Electron/Node runtime shipped with VS Code 1.85+.
    target: 'node18',
    outdir: 'dist',
    // `vscode` is provided by the host at runtime and must never be bundled.
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'warning',
    plugins: [problemMatcherPlugin],
  });

  if (watch) {
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
