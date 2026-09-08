/*
 * Grid picker webview.
 *
 * Owns nothing but presentation and input. All searching happens in the
 * extension host (it has the 51k-name index); this file sends queries and
 * renders whatever comes back.
 *
 * Protocol
 *   webview -> host   { type: 'ready' }
 *                     { type: 'search', requestId, query, limit }
 *                     { type: 'pick', name, set }
 *                     { type: 'cancel' }
 *                     { type: 'sizeChanged', size }
 *   host -> webview   { type: 'init', iconSize, pageSize, debounceMs }
 *                     { type: 'results', requestId, icons, total, limit }
 */

// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const search = /** @type {HTMLInputElement} */ (document.getElementById('search'));
  const sizeSlider = /** @type {HTMLInputElement} */ (document.getElementById('size'));
  const sizeLabel = /** @type {HTMLElement} */ (document.getElementById('size-label'));
  const grid = /** @type {HTMLElement} */ (document.getElementById('grid'));
  const status = /** @type {HTMLElement} */ (document.getElementById('status'));
  const gridWrap = /** @type {HTMLElement} */ (document.getElementById('grid-wrap'));

  let pageSize = 120;
  let debounceMs = 120;
  let limit = pageSize;
  /** Monotonic id so a late response for an abandoned query is ignored. */
  let requestId = 0;
  let debounceTimer;
  /** Index of the focused cell, for arrow-key navigation. */
  let activeIndex = -1;
  let cells = [];

  // Restore the last query across panel reloads.
  const previous = vscode.getState();
  if (previous && typeof previous.query === 'string') {
    search.value = previous.query;
  }

  /* ------------------------------------------------------------- searching */

  function runSearch(reset) {
    if (reset) {
      limit = pageSize;
    }
    requestId++;
    vscode.setState({ query: search.value });
    vscode.postMessage({
      type: 'search',
      requestId,
      query: search.value,
      limit,
    });
  }

  function scheduleSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(true), debounceMs);
  }

  search.addEventListener('input', scheduleSearch);

  /* --------------------------------------------------------------- sizing */

  function applySize(size, persist) {
    document.documentElement.style.setProperty('--icon-size', size + 'px');
    sizeLabel.textContent = size + 'px';
    sizeSlider.value = String(size);
    if (persist) {
      vscode.postMessage({ type: 'sizeChanged', size });
    }
  }

  sizeSlider.addEventListener('input', () => applySize(Number(sizeSlider.value), false));
  // Only write the setting when the drag ends, not on every intermediate value.
  sizeSlider.addEventListener('change', () => applySize(Number(sizeSlider.value), true));

  /* ------------------------------------------------------------- rendering */

  function render(icons, total, shownLimit) {
    grid.textContent = '';
    cells = [];
    activeIndex = -1;

    if (icons.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = search.value
        ? 'No icons match "' + search.value + '".'
        : 'Type to search.';
      grid.appendChild(empty);
      status.textContent = '';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const icon of icons) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.tabIndex = -1;
      cell.title = icon.name + '  —  ' + icon.setLabel;
      cell.dataset.name = icon.name;
      cell.dataset.set = icon.set;

      // The SVG body comes from this extension's own build-time index, and the
      // page's CSP (script-src 'nonce-...') blocks any script it could carry.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', icon.viewBox);
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = icon.body;

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = icon.name;

      cell.appendChild(svg);
      cell.appendChild(name);
      fragment.appendChild(cell);
      cells.push(cell);
    }
    grid.appendChild(fragment);

    if (total > icons.length) {
      const more = document.createElement('button');
      more.className = 'more';
      more.type = 'button';
      more.textContent = 'Load more';
      more.addEventListener('click', () => {
        limit = shownLimit * 4;
        runSearch(false);
      });
      grid.appendChild(more);
      status.textContent = 'Showing ' + icons.length + ' of ' + total + ' matches';
    } else {
      status.textContent = total + (total === 1 ? ' match' : ' matches');
    }
  }

  /* ---------------------------------------------------------- interaction */

  function pick(cell) {
    if (!cell) {
      return;
    }
    vscode.postMessage({ type: 'pick', name: cell.dataset.name, set: cell.dataset.set });
  }

  grid.addEventListener('click', (event) => {
    const cell = /** @type {HTMLElement} */ (event.target).closest('.cell');
    pick(cell);
  });

  function setActive(index) {
    if (cells.length === 0) {
      return;
    }
    const next = Math.max(0, Math.min(index, cells.length - 1));
    if (cells[activeIndex]) {
      cells[activeIndex].classList.remove('active');
    }
    activeIndex = next;
    cells[activeIndex].classList.add('active');
    cells[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  /** How many cells fit per row, so Up/Down move a visual row. */
  function columnCount() {
    if (cells.length < 2) {
      return 1;
    }
    const top = cells[0].offsetTop;
    let count = 0;
    while (count < cells.length && cells[count].offsetTop === top) {
      count++;
    }
    return Math.max(1, count);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      vscode.postMessage({ type: 'cancel' });
      return;
    }

    if (event.key === 'Enter') {
      if (activeIndex >= 0) {
        event.preventDefault();
        pick(cells[activeIndex]);
      } else if (cells.length > 0) {
        // Enter straight from the search box takes the first result.
        event.preventDefault();
        pick(cells[0]);
      }
      return;
    }

    const columns = columnCount();
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        setActive(activeIndex + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        setActive(activeIndex <= 0 ? 0 : activeIndex - 1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActive(activeIndex < 0 ? 0 : activeIndex + columns);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (activeIndex - columns < 0) {
          // Off the top of the grid: go back to the search box.
          if (cells[activeIndex]) {
            cells[activeIndex].classList.remove('active');
          }
          activeIndex = -1;
          search.focus();
          search.select();
        } else {
          setActive(activeIndex - columns);
        }
        break;
      case 'Home':
        if (activeIndex >= 0) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (activeIndex >= 0) {
          event.preventDefault();
          setActive(cells.length - 1);
        }
        break;
      default:
        // Any printable key returns to the search box, so you can keep typing
        // to refine without reaching for the mouse.
        if (
          document.activeElement !== search &&
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          search.focus();
        }
    }
  });

  gridWrap.addEventListener('mousedown', (event) => {
    // Keep the caret in the search box when clicking empty grid space.
    if (event.target === gridWrap || event.target === grid) {
      event.preventDefault();
    }
  });

  /* -------------------------------------------------------------- messages */

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'init':
        pageSize = message.pageSize;
        debounceMs = message.debounceMs;
        limit = pageSize;
        sizeSlider.min = String(message.minSize);
        sizeSlider.max = String(message.maxSize);
        applySize(message.iconSize, false);
        search.focus();
        search.select();
        runSearch(true);
        break;

      case 'results':
        // Ignore anything that is not the newest request in flight.
        if (message.requestId === requestId) {
          render(message.icons, message.total, message.limit);
        }
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
