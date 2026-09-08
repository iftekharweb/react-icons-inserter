import * as vscode from 'vscode';
import { disposeProject } from './astProject';
import { IconHoverProvider } from './hoverProvider';
import { IconIndex, type IconRef } from './iconIndex';
import { insertIcon } from './importManager';
import { pickIconGrid } from './gridPicker';
import { pickIcon } from './quickPick';

const REACT_LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'];

/** Cheap heuristic: does this text look like a React file? */
const REACT_HINT = /(from\s+['"]react['"])|(require\(['"]react['"]\))|(<[A-Z][\w.]*[\s/>])|(<>)/;

let index: IconIndex | undefined;

/**
 * ACTIVATION
 * ----------
 * Activation is scoped to the four JS/TS languages plus the contributed
 * commands -- never `*`, never `onStartupFinished`. The `onLanguage:*` events
 * are required (not merely nice): a hover provider cannot be registered before
 * the extension is running, so without them hovers would only work after the
 * user had already invoked the insert command once.
 *
 * activate() itself does no I/O. The 840 KB name index is not touched here --
 * `IconIndex.load()` is called lazily by the first search or hover, and both
 * paths are async and cancellable.
 */
export function activate(context: vscode.ExtensionContext): void {
  index = new IconIndex(context.extensionPath);
  const iconIndex = index;
  const extensionUri = context.extensionUri;

  const selector = REACT_LANGUAGES.map((language) => ({ language, scheme: 'file' }));
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, new IconHoverProvider(iconIndex)),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reactIcons.insert', () => runInsert(iconIndex, extensionUri)),
    vscode.commands.registerCommand(
      'reactIcons.replaceAtCursor',
      (uri?: string, line?: number, character?: number) =>
        runReplace(iconIndex, extensionUri, uri, line, character),
    ),
  );

  // `reactIcons.isReactFile` drives the context-menu entry and the keybinding.
  // Recomputed only when the active editor changes or its document is edited,
  // and the check itself is a single regex over the first 4 KB of text.
  const updateContext = (editor: vscode.TextEditor | undefined): void => {
    void vscode.commands.executeCommand(
      'setContext',
      'reactIcons.isReactFile',
      isReactFile(editor?.document),
    );
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateContext),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) {
        updateContext(vscode.window.activeTextEditor);
      }
    }),
  );
  updateContext(vscode.window.activeTextEditor);

  context.subscriptions.push({
    dispose: () => {
      iconIndex.dispose();
      disposeProject();
    },
  });
}

export function deactivate(): void {
  index?.dispose();
  index = undefined;
  disposeProject();
}

/**
 * `.ts`/`.js` files are only offered the command when they actually look like
 * React -- a plain Node script has no business getting an "Insert React Icon"
 * entry. `.tsx`/`.jsx` always qualify. Only the first 4 KB is scanned so a huge
 * file does not stall the context-menu computation.
 */
export function isReactFile(document: vscode.TextDocument | undefined): boolean {
  if (!document || !REACT_LANGUAGES.includes(document.languageId)) {
    return false;
  }
  if (document.languageId === 'javascriptreact' || document.languageId === 'typescriptreact') {
    return true;
  }
  const head = document.getText(
    new vscode.Range(document.positionAt(0), document.positionAt(Math.min(4096, document.getText().length))),
  );
  return REACT_HINT.test(head);
}

/**
 * Route to whichever picker the user configured. The grid is a webview panel
 * (see gridPicker.ts for why a QuickPick cannot render one); the list is the
 * native QuickPick, which stays available because it is faster for anyone who
 * already knows the icon's name.
 */
function choosePicker(
  iconIndex: IconIndex,
  scope: vscode.Uri,
  extensionUri: vscode.Uri,
): Thenable<IconRef | undefined> {
  const style = vscode.workspace
    .getConfiguration('reactIcons', scope)
    .get<'grid' | 'list'>('pickerStyle', 'grid');
  return style === 'list'
    ? pickIcon(iconIndex, scope)
    : pickIconGrid(iconIndex, scope, extensionUri);
}

async function runInsert(iconIndex: IconIndex, extensionUri: vscode.Uri): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Open a React file first.');
    return;
  }
  const icon = await choosePicker(iconIndex, editor.document.uri, extensionUri);
  if (!icon) {
    return;
  }
  const result = await insertIcon(editor, icon);
  if (result?.createdBarrel) {
    void vscode.window.showInformationMessage(
      `Created ${vscode.workspace.asRelativePath(result.barrel.uri)} for react-icons re-exports.`,
    );
  }
}

/** Hover's "Change icon" link: swap the identifier at the given position. */
async function runReplace(
  iconIndex: IconIndex,
  extensionUri: vscode.Uri,
  uriString?: string,
  line?: number,
  character?: number,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const position =
    line !== undefined && character !== undefined
      ? new vscode.Position(line, character)
      : editor.selection.active;

  if (uriString && editor.document.uri.toString() !== uriString) {
    void vscode.window.showWarningMessage('Open the file containing that icon and try again.');
    return;
  }

  const range = editor.document.getWordRangeAtPosition(position, /[A-Za-z_$][A-Za-z0-9_$]*/);
  if (!range) {
    void vscode.window.showWarningMessage('Place the cursor on an icon name first.');
    return;
  }

  const icon = await choosePicker(iconIndex, editor.document.uri, extensionUri);
  if (!icon) {
    return;
  }
  // Only the identifier is swapped -- the JSX element around it stays intact,
  // so `<FaBeer className="x" />` keeps its props. The now-unused import of the
  // previous icon is deliberately left alone: removing it safely means proving
  // no other reference exists, which is the language server's job, not ours.
  await insertIcon(editor, icon, { replaceRange: range, identifierOnly: true });
}
