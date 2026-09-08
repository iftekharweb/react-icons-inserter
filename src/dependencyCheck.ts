import * as vscode from 'vscode';

/**
 * The extension itself never needs `react-icons` installed -- the SVG data is
 * pre-baked into `assets/icon-index/`. The *generated barrel file* does, since
 * it re-exports from `react-icons/*` at runtime. So we check the workspace's
 * package.json once per session and nudge the user if it is missing.
 *
 * Checked lazily and at most once per workspace folder: reading package.json on
 * every insert would be wasted I/O.
 */
const checked = new Set<string>();

export async function ensureReactIconsDependency(
  folder: vscode.WorkspaceFolder,
  scope: vscode.Uri,
): Promise<void> {
  if (!vscode.workspace.getConfiguration('reactIcons', scope).get<boolean>('checkReactIconsDependency', true)) {
    return;
  }
  const key = folder.uri.toString();
  if (checked.has(key)) {
    return;
  }
  checked.add(key);

  const packageJsonUri = vscode.Uri.joinPath(folder.uri, 'package.json');
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    const raw = await vscode.workspace.fs.readFile(packageJsonUri);
    manifest = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    // No package.json, or it is not valid JSON. Nothing useful to say.
    return;
  }

  if (manifest.dependencies?.['react-icons'] ?? manifest.devDependencies?.['react-icons']) {
    return;
  }

  const install = 'Install react-icons';
  const choice = await vscode.window.showWarningMessage(
    'The generated icon barrel re-exports from "react-icons", which is not in this project\'s package.json.',
    install,
    'Dismiss',
  );
  if (choice !== install) {
    return;
  }

  const terminal = vscode.window.createTerminal({ name: 'react-icons', cwd: folder.uri });
  terminal.show(true);
  terminal.sendText('npm install react-icons');
}

/** Test/reset hook -- lets a reload re-check a workspace. */
export function resetDependencyCheck(): void {
  checked.clear();
}
