import * as vscode from 'vscode';
import type { IconIndex, IconRef } from './iconIndex';

/**
 * The grid picker.
 *
 * WHY A WEBVIEW
 * -------------
 * `QuickPick` cannot do this. It is a fixed-height single-column list, and
 * `QuickPickItem.iconPath` renders at a fixed ~16px no matter what the SVG
 * declares. There is no API to change either. Browsing 50k icons by shape
 * rather than by name needs a grid with legible glyphs, so it needs a webview.
 *
 * The QuickPick remains available via `reactIcons.pickerStyle` -- it is faster
 * for someone who knows the icon's name and never leaves the keyboard.
 *
 * DIVISION OF LABOUR
 * ------------------
 * The webview owns presentation and input only. Searching stays in the
 * extension host, which already has the index; the host ships at most a page of
 * results at a time, so the 33 MB of SVG data never crosses the boundary.
 */

interface ReadyMessage {
  type: 'ready';
}
interface SearchMessage {
  type: 'search';
  requestId: number;
  query: string;
  limit: number;
}
interface PickMessage {
  type: 'pick';
  name: string;
  set: string;
}
interface CancelMessage {
  type: 'cancel';
}
interface SizeMessage {
  type: 'sizeChanged';
  size: number;
}

type InboundMessage = ReadyMessage | SearchMessage | PickMessage | CancelMessage | SizeMessage;

const MIN_ICON_SIZE = 16;
const MAX_ICON_SIZE = 96;

/** Results per page. Higher than the QuickPick default -- a grid shows far more
 *  per screen, and a page of 120 is roughly 120 KB of SVG over the bridge. */
const PAGE_SIZE = 120;

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

export function pickIconGrid(
  index: IconIndex,
  scope: vscode.Uri,
  extensionUri: vscode.Uri,
): Promise<IconRef | undefined> {
  const config = vscode.workspace.getConfiguration('reactIcons', scope);
  const iconSize = Math.min(
    MAX_ICON_SIZE,
    Math.max(MIN_ICON_SIZE, config.get<number>('gridIconSize', 32)),
  );
  const debounceMs = config.get<number>('searchDebounceMs', 120);

  const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
  const panel = vscode.window.createWebviewPanel(
    'reactIcons.picker',
    'Insert React Icon',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    {
      enableScripts: true,
      // The panel is disposed as soon as a pick is made or it is closed, so
      // there is no state worth retaining while hidden.
      retainContextWhenHidden: false,
      localResourceRoots: [mediaUri],
    },
  );

  panel.webview.html = renderHtml(panel.webview, mediaUri);

  return new Promise<IconRef | undefined>((resolve) => {
    let settled = false;
    /** Guards against a slow search resolving after the panel is gone. */
    let disposed = false;

    const finish = (icon: IconRef | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(icon);
      panel.dispose();
    };

    panel.onDidDispose(() => {
      disposed = true;
      finish(undefined);
    });

    /**
     * Resolve a page of results into something renderable: name, set label, and
     * the raw `[viewBox, body]` the webview wraps in its own <svg>. Sending
     * geometry rather than a data URI keeps the payload small and lets the
     * webview colour icons with `currentColor`, so selection inverts correctly.
     */
    const send = async (requestId: number, query: string, limit: number): Promise<void> => {
      await index.load();
      if (disposed) {
        return;
      }

      const result = index.search(query, limit);
      const icons = await Promise.all(
        result.icons.map(async (icon) => {
          const svg = await index.getSvg(icon).catch(() => undefined);
          return svg
            ? {
                name: icon.name,
                set: icon.set,
                setLabel: icon.setLabel,
                viewBox: svg[0],
                body: svg[1],
              }
            : undefined;
        }),
      );

      if (disposed) {
        return;
      }
      void panel.webview.postMessage({
        type: 'results',
        requestId,
        icons: icons.filter(Boolean),
        total: result.total,
        limit,
      });
    };

    panel.webview.onDidReceiveMessage((message: InboundMessage) => {
      switch (message.type) {
        case 'ready':
          void panel.webview.postMessage({
            type: 'init',
            iconSize,
            pageSize: PAGE_SIZE,
            debounceMs,
            minSize: MIN_ICON_SIZE,
            maxSize: MAX_ICON_SIZE,
          });
          break;

        case 'search':
          void send(message.requestId, message.query, message.limit);
          break;

        case 'pick': {
          const icon = index
            .resolveByName(message.name)
            .find((candidate) => candidate.set === message.set);
          finish(icon);
          break;
        }

        case 'cancel':
          finish(undefined);
          break;

        case 'sizeChanged':
          // Persist globally: the size is a personal preference, not a
          // property of whichever workspace happened to be open.
          void vscode.workspace
            .getConfiguration('reactIcons')
            .update('gridIconSize', message.size, vscode.ConfigurationTarget.Global);
          break;
      }
    });
  });
}

function renderHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'picker.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'picker.css'));
  const csp = nonce();

  // `script-src 'nonce-...'` is what makes it safe to inject icon markup into
  // the DOM: even if a future icon set shipped a <script> inside its SVG, it
  // could not run.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${csp}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Insert React Icon</title>
</head>
<body>
  <div class="toolbar">
    <input id="search" type="text" placeholder="Search react-icons — try &quot;beer&quot;, &quot;arrow left&quot;, &quot;home&quot;" autocomplete="off" spellcheck="false">
    <label class="size-control" for="size">
      Size
      <input id="size" type="range" min="16" max="96" step="4">
      <span id="size-label">32px</span>
    </label>
  </div>
  <div class="status" id="status"></div>
  <div class="grid-wrap" id="grid-wrap">
    <div id="grid"></div>
  </div>
  <script nonce="${csp}" src="${scriptUri}"></script>
</body>
</html>`;
}
