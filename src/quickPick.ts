import * as vscode from 'vscode';
import type { IconIndex, IconRef } from './iconIndex';

interface IconItem extends vscode.QuickPickItem {
  icon?: IconRef;
  /** Sentinel item that widens the result cap instead of picking an icon. */
  showMore?: boolean;
}

/** Preview glyph colour. VS Code renders QuickPick icons outside theme CSS, so
 *  `currentColor` is unusable -- pick a literal that reads on the active theme. */
function previewColor(): string {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? '#3b3b3b'
    : '#cccccc';
}

/**
 * The searchable icon picker.
 *
 * Three things keep this responsive against a ~51k-icon index:
 *
 *  1. **Debounce.** `onDidChangeValue` only schedules a search; the search runs
 *     `reactIcons.searchDebounceMs` (default 120 ms) later. Fast typists never
 *     trigger more than one scan.
 *  2. **Cancellation.** Each scheduled search owns a token. A newer keystroke
 *     cancels the older token, and `IconIndex.search` polls it mid-scan, so
 *     superseded work is abandoned instead of completing and being thrown away.
 *  3. **Two-pass rendering.** Items appear immediately with text only; SVG
 *     previews are attached in a second pass once the relevant per-set JSON has
 *     loaded, and are dropped on the floor if the query moved on. Waiting for a
 *     4 MB set file before showing any result would feel broken.
 *
 * `matchOnDescription`/native filtering stays off: the QuickPick must show
 * exactly what our ranking produced, not re-filter it.
 */
export function pickIcon(index: IconIndex, scope: vscode.Uri): Promise<IconRef | undefined> {
  const config = vscode.workspace.getConfiguration('reactIcons', scope);
  const baseLimit = config.get<number>('maxResults', 50);
  const debounceMs = config.get<number>('searchDebounceMs', 120);
  const previewsEnabled = config.get<boolean>('enableQuickPickPreviews', true);
  const color = previewColor();

  const quickPick = vscode.window.createQuickPick<IconItem>();
  quickPick.title = 'Insert React Icon';
  quickPick.placeholder = 'Search react-icons, e.g. "beer", "arrow left", "home"';
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;
  quickPick.busy = true;
  quickPick.show();

  let limit = baseLimit;
  let generation = 0;
  let timer: NodeJS.Timeout | undefined;
  let tokenSource: vscode.CancellationTokenSource | undefined;
  let resolved = false;

  return new Promise<IconRef | undefined>((resolve) => {
    const finish = (icon: IconRef | undefined): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      if (timer) {
        clearTimeout(timer);
      }
      tokenSource?.cancel();
      tokenSource?.dispose();
      quickPick.dispose();
      resolve(icon);
    };

    /** Second pass: attach data-URI previews without blocking the first paint. */
    const attachPreviews = async (items: IconItem[], forGeneration: number): Promise<void> => {
      const uris = await Promise.all(
        items.map((item) =>
          item.icon ? index.getDataUri(item.icon, 16, color).catch(() => undefined) : undefined,
        ),
      );
      if (forGeneration !== generation || resolved) {
        return;
      }
      let changed = false;
      items.forEach((item, i) => {
        const uri = uris[i];
        if (uri) {
          item.iconPath = vscode.Uri.parse(uri);
          changed = true;
        }
      });
      if (changed) {
        // Reassigning the array is what makes VS Code re-render the rows.
        quickPick.items = [...items];
      }
    };

    const runSearch = (query: string): void => {
      const current = ++generation;
      tokenSource?.cancel();
      tokenSource?.dispose();
      tokenSource = new vscode.CancellationTokenSource();

      const result = index.search(query, limit, tokenSource.token);
      if (current !== generation || result.cancelled) {
        return;
      }

      const items: IconItem[] = result.icons.map((icon) => ({
        label: icon.name,
        description: icon.setLabel,
        icon,
      }));

      if (result.total > result.icons.length) {
        items.push({
          label: `$(ellipsis) Show more`,
          description: `showing ${result.icons.length} of ${result.total} matches`,
          alwaysShow: true,
          showMore: true,
        });
      }

      quickPick.items = items;
      quickPick.busy = false;

      if (previewsEnabled) {
        void attachPreviews(items, current);
      }
    };

    const schedule = (query: string): void => {
      if (timer) {
        clearTimeout(timer);
      }
      quickPick.busy = true;
      timer = setTimeout(() => {
        timer = undefined;
        runSearch(query);
      }, debounceMs);
    };

    quickPick.onDidChangeValue((value) => {
      limit = baseLimit; // a new query resets any "show more" expansion
      schedule(value);
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (!selected) {
        return;
      }
      if (selected.showMore) {
        limit *= 4;
        runSearch(quickPick.value);
        return;
      }
      finish(selected.icon);
    });

    quickPick.onDidHide(() => finish(undefined));

    // Loading the name index is the only slow step, and it happens once per
    // session. Show the picker immediately and fill it when the index lands.
    void index
      .load()
      .then(() => {
        if (!resolved) {
          runSearch(quickPick.value);
        }
      })
      .catch((error: unknown) => {
        void vscode.window.showErrorMessage(`Could not load the icon index: ${String(error)}`);
        finish(undefined);
      });
  });
}
