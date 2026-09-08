/**
 * Renders the README preview images for the grid picker.
 *
 * These are RENDERINGS, not screen captures. They are composed from the same
 * three sources the real picker uses -- the metrics in `media/picker.css`, the
 * VS Code Dark Modern theme colours those CSS variables resolve to, and real
 * search results from `IconIndex` -- so the layout, spacing and icon set shown
 * are the genuine article rather than a mockup. What they cannot reproduce is
 * VS Code's own font rasterisation and window chrome.
 *
 *   npm run generate-screenshots      (requires `npm run generate-index` first)
 *
 * Regenerate after changing picker.css so the README cannot drift from the UI.
 * Development-time only; `sharp` is a devDependency and does not ship.
 */

import * as path from 'node:path';
import sharp from 'sharp';
import { IconIndex, type IconRef } from '../src/iconIndex';

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'media');

/** VS Code Dark Modern — the values picker.css's --vscode-* variables resolve to. */
const THEME = {
  editorBackground: '#1F1F1F',
  foreground: '#CCCCCC',
  panelBorder: '#2B2B2B',
  inputBackground: '#313131',
  inputBorder: '#3C3C3C',
  inputForeground: '#CCCCCC',
  placeholder: '#989898',
  description: '#9D9D9D',
  hoverBackground: '#2A2D2E',
  selectionBackground: '#04395E',
  selectionForeground: '#FFFFFF',
  focusBorder: '#0078D4',
  sliderTrack: '#3C3C3C',
};

/** Metrics lifted from media/picker.css so the two cannot disagree. */
const CSS = {
  toolbarPaddingY: 10,
  toolbarPaddingX: 12,
  toolbarGap: 12,
  inputPaddingY: 6,
  inputPaddingX: 8,
  statusPaddingTop: 4,
  statusPaddingBottom: 8,
  gridPaddingX: 12,
  gridPaddingBottom: 12,
  gridGap: 6,
  cellPadding: 10,
  cellGap: 6,
  cellRadius: 4,
  labelExtra: 28, // the +28px in the grid-template-columns minmax()
  fontSize: 13,
  labelFontSize: 10.1, // 0.78em
  labelLineHeight: 12.6, // 1.25
};

const FONT = 'Segoe UI, system-ui, sans-serif';

interface Shot {
  file: string;
  query: string;
  iconSize: number;
  width: number;
  rows: number;
  /** Index of the cell drawn as keyboard-selected. */
  active: number;
}

const SHOTS: Shot[] = [
  { file: 'screenshot-grid.png', query: 'arrow', iconSize: 32, width: 1100, rows: 5, active: 14 },
  { file: 'screenshot-grid-large.png', query: 'home', iconSize: 64, width: 1100, rows: 3, active: 5 },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Segoe UI averages ~0.52em per character at these sizes. Good enough to wrap. */
function wrapLabel(name: string, maxWidth: number, fontSize: number): string[] {
  const perChar = fontSize * 0.52;
  const maxChars = Math.max(4, Math.floor(maxWidth / perChar));
  if (name.length <= maxChars) {
    return [name];
  }
  // The webview wraps with `overflow-wrap: anywhere`, i.e. mid-word.
  const first = name.slice(0, maxChars);
  const rest = name.slice(maxChars);
  return [first, rest.length <= maxChars ? rest : rest.slice(0, maxChars - 1) + '…'];
}

function renderIcon(icon: { viewBox: string; body: string }, x: number, y: number, size: number, color: string): string {
  const [minX, minY, w, h] = icon.viewBox.split(/\s+/).map(Number);
  const scale = size / Math.max(w, h);
  const tx = x - (w * scale) / 2 - minX * scale;
  const ty = y - (h * scale) / 2 - minY * scale;
  // `color` matters as much as `fill`: several sets (cg, rx, ...) emit children
  // with an explicit fill="currentColor", which resolves against the CSS color
  // property, not the parent's fill attribute. The real webview inherits color
  // from body; without it here those icons would render black on black.
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})" color="${color}" fill="${color}" stroke="${color}" stroke-width="0">${icon.body}</g>`;
}

async function buildShot(index: IconIndex, shot: Shot): Promise<string> {
  const result = index.search(shot.query, 400);

  // Column maths, exactly as the CSS grid computes it.
  const gridWidth = shot.width - CSS.gridPaddingX * 2;
  const minCell = shot.iconSize + CSS.cellPadding * 2 + CSS.labelExtra;
  const columns = Math.max(1, Math.floor((gridWidth + CSS.gridGap) / (minCell + CSS.gridGap)));
  const cellWidth = (gridWidth - CSS.gridGap * (columns - 1)) / columns;
  const cellHeight =
    CSS.cellPadding * 2 + shot.iconSize + CSS.cellGap + CSS.labelLineHeight * 2;

  const visible = result.icons.slice(0, columns * shot.rows);
  const withSvg: (IconRef & { viewBox: string; body: string })[] = [];
  for (const icon of visible) {
    const svg = await index.getSvg(icon);
    if (svg) {
      withSvg.push({ ...icon, viewBox: svg[0], body: svg[1] });
    }
  }

  const inputHeight = CSS.fontSize * 1.35 + CSS.inputPaddingY * 2 + 2;
  const toolbarHeight = CSS.toolbarPaddingY * 2 + inputHeight;
  const statusY = toolbarHeight + CSS.statusPaddingTop + CSS.fontSize;
  const statusHeight = CSS.statusPaddingTop + CSS.fontSize * 1.2 + CSS.statusPaddingBottom;
  const gridTop = toolbarHeight + statusHeight;
  const height = gridTop + shot.rows * cellHeight + (shot.rows - 1) * CSS.gridGap + CSS.gridPaddingBottom;

  const parts: string[] = [];
  parts.push(
    `<rect width="${shot.width}" height="${height}" fill="${THEME.editorBackground}"/>`,
  );

  /* -- toolbar ---------------------------------------------------------- */
  const sizeControlWidth = 200;
  const inputWidth = shot.width - CSS.toolbarPaddingX * 2 - sizeControlWidth - CSS.toolbarGap;
  parts.push(
    `<rect x="${CSS.toolbarPaddingX}" y="${CSS.toolbarPaddingY}" width="${inputWidth}" height="${inputHeight}" rx="2" fill="${THEME.inputBackground}" stroke="${THEME.focusBorder}"/>`,
  );
  const textBaseline = CSS.toolbarPaddingY + inputHeight / 2 + CSS.fontSize * 0.36;
  parts.push(
    `<text x="${CSS.toolbarPaddingX + CSS.inputPaddingX}" y="${textBaseline}" font-family="${FONT}" font-size="${CSS.fontSize}" fill="${THEME.inputForeground}">${escapeXml(shot.query)}</text>`,
  );
  // Caret, as the focused input would show.
  const caretX = CSS.toolbarPaddingX + CSS.inputPaddingX + shot.query.length * CSS.fontSize * 0.52 + 1.5;
  parts.push(
    `<rect x="${caretX.toFixed(1)}" y="${CSS.toolbarPaddingY + CSS.inputPaddingY + 1}" width="1.4" height="${CSS.fontSize * 1.25}" fill="${THEME.foreground}"/>`,
  );

  // Size slider.
  const sizeX = CSS.toolbarPaddingX + inputWidth + CSS.toolbarGap;
  const midY = CSS.toolbarPaddingY + inputHeight / 2;
  parts.push(
    `<text x="${sizeX}" y="${midY + CSS.fontSize * 0.36}" font-family="${FONT}" font-size="${CSS.fontSize}" fill="${THEME.description}">Size</text>`,
  );
  const trackX = sizeX + 34;
  const trackW = 90;
  parts.push(
    `<rect x="${trackX}" y="${midY - 1.5}" width="${trackW}" height="3" rx="1.5" fill="${THEME.sliderTrack}"/>`,
  );
  const ratio = (shot.iconSize - 16) / (96 - 16);
  const thumbX = trackX + trackW * ratio;
  parts.push(
    `<rect x="${trackX}" y="${midY - 1.5}" width="${(trackW * ratio).toFixed(1)}" height="3" rx="1.5" fill="${THEME.focusBorder}"/>`,
    `<circle cx="${thumbX.toFixed(1)}" cy="${midY}" r="6" fill="${THEME.focusBorder}"/>`,
    `<text x="${trackX + trackW + 10}" y="${midY + CSS.fontSize * 0.36}" font-family="${FONT}" font-size="${CSS.fontSize}" fill="${THEME.description}">${shot.iconSize}px</text>`,
  );

  parts.push(
    `<rect x="0" y="${toolbarHeight - 1}" width="${shot.width}" height="1" fill="${THEME.panelBorder}"/>`,
  );

  /* -- status ----------------------------------------------------------- */
  const status =
    result.total > withSvg.length
      ? `Showing ${withSvg.length} of ${result.total} matches`
      : `${result.total} matches`;
  parts.push(
    `<text x="${CSS.gridPaddingX}" y="${statusY}" font-family="${FONT}" font-size="${(CSS.fontSize * 0.9).toFixed(1)}" fill="${THEME.description}">${escapeXml(status)}</text>`,
  );

  /* -- grid ------------------------------------------------------------- */
  withSvg.forEach((icon, i) => {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const x = CSS.gridPaddingX + column * (cellWidth + CSS.gridGap);
    const y = gridTop + row * (cellHeight + CSS.gridGap);

    const isActive = i === shot.active;
    // One neighbouring cell shows the hover state, as a pointer would.
    const isHover = i === shot.active + 1;

    if (isActive) {
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellWidth.toFixed(1)}" height="${cellHeight.toFixed(1)}" rx="${CSS.cellRadius}" fill="${THEME.selectionBackground}" stroke="${THEME.focusBorder}"/>`,
      );
    } else if (isHover) {
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellWidth.toFixed(1)}" height="${cellHeight.toFixed(1)}" rx="${CSS.cellRadius}" fill="${THEME.hoverBackground}"/>`,
      );
    }

    const glyphColor = isActive ? THEME.selectionForeground : THEME.foreground;
    parts.push(
      renderIcon(
        icon,
        x + cellWidth / 2,
        y + CSS.cellPadding + shot.iconSize / 2,
        shot.iconSize,
        glyphColor,
      ),
    );

    const labelTop = y + CSS.cellPadding + shot.iconSize + CSS.cellGap + CSS.labelFontSize;
    const lines = wrapLabel(icon.name, cellWidth - 6, CSS.labelFontSize);
    const labelOpacity = isActive ? '1' : '0.85';
    lines.forEach((line, li) => {
      parts.push(
        `<text x="${(x + cellWidth / 2).toFixed(1)}" y="${(labelTop + li * CSS.labelLineHeight).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="${CSS.labelFontSize}" fill="${glyphColor}" opacity="${labelOpacity}">${escapeXml(line)}</text>`,
      );
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${shot.width}" height="${height.toFixed(0)}" viewBox="0 0 ${shot.width} ${height.toFixed(0)}">${parts.join('')}</svg>`;
}

async function main(): Promise<void> {
  const index = new IconIndex(ROOT);
  await index.load();

  for (const shot of SHOTS) {
    const svg = await buildShot(index, shot);
    // Rendered at 2x so the image stays crisp on high-DPI displays, then
    // displayed at half width in the README.
    const info = await sharp(Buffer.from(svg), { density: 144 })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, shot.file));
    console.log(`media/${shot.file.padEnd(28)} ${info.width}x${info.height}, ${(info.size / 1024).toFixed(0)} KB`);
  }
}

void main();
