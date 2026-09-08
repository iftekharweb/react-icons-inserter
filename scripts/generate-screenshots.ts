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

/* ========================================================================== *
 * Hover preview
 * ========================================================================== */

/** Dark Modern editor token colours. */
const CODE = {
  background: '#1F1F1F',
  plain: '#CCCCCC',
  keyword: '#C586C0', // import / from / export
  declaration: '#569CD6', // const
  variable: '#9CDCFE',
  type: '#4EC9B0', // components and JSX tags
  string: '#CE9178',
  punctuation: '#808080',
  lineNumber: '#6E7681',
  hoverBackground: '#202020',
  hoverBorder: '#454545',
  inlineCodeBackground: '#2C2C2C',
  link: '#4DAAFC',
};

// Single quotes inside: these land in an XML attribute delimited by double
// quotes, and a nested `"` silently truncates it into invalid markup.
const MONO = "Consolas, 'Courier New', monospace";
/** Only used to place the hover widget near its token. Text layout does not
 *  depend on it -- see the <tspan> note in buildHoverShot. */
const CHAR_W = 7.9;
const LINE_H = 19;
const CODE_FONT = 14;

type Span = [text: string, color: string];

/** The file shown behind the hover. Spans are hand-annotated rather than run
 *  through a highlighter -- it is six fixed lines, not arbitrary input. */
const CODE_LINES: Span[][] = [
  [
    ['import', CODE.keyword],
    [' { ', CODE.punctuation],
    ['FaBeer', CODE.variable],
    [', ', CODE.punctuation],
    ['MdHome', CODE.variable],
    [' } ', CODE.punctuation],
    ['from', CODE.keyword],
    [' ', CODE.plain],
    ["'../../icons/react-icons'", CODE.string],
    [';', CODE.punctuation],
  ],
  [],
  [
    ['export', CODE.keyword],
    [' ', CODE.plain],
    ['const', CODE.declaration],
    [' ', CODE.plain],
    ['Widget', CODE.type],
    [' = () ', CODE.punctuation],
    ['=>', CODE.declaration],
    [' (', CODE.punctuation],
  ],
  [
    ['  <', CODE.punctuation],
    ['div', CODE.type],
    ['>', CODE.punctuation],
  ],
  [
    ['    <', CODE.punctuation],
    ['FaBeer', CODE.type],
    [' />', CODE.punctuation],
  ],
  [
    ['  </', CODE.punctuation],
    ['div', CODE.type],
    ['>', CODE.punctuation],
  ],
  [[');', CODE.punctuation]],
];

/** Line (0-based) and column of the token the pointer is over. */
const HOVER_LINE = 4;
const HOVER_COL = 5;

interface HoverContent {
  dataUri: string;
  title: string;
  aliasOf?: string;
  setLabel: string;
  modulePath: string;
  importedFrom: string;
  linkText: string;
}

/**
 * Drive the real `IconHoverProvider` through the test's `vscode` stub and parse
 * what it actually produced. The text in the image is therefore generated by
 * the shipping code path, not transcribed by hand -- if the hover's wording
 * changes, regenerating the image picks it up.
 */
async function captureHover(): Promise<HoverContent> {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const stub = require('../test/vscodeStub');
  stub.installVscodeStub();

  const { IconHoverProvider } = require('../src/hoverProvider');
  const { IconIndex: Index } = require('../src/iconIndex');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const widget = 'C:\\proj\\src\\features\\Widget.tsx';
  stub.reset();
  stub.files.set(stub.norm('C:\\proj\\tsconfig.json'), '{}');
  stub.files.set(
    stub.norm('C:\\proj\\icons\\react-icons.ts'),
    "export { FaBeer } from 'react-icons/fa';\nexport { MdHome } from 'react-icons/md';\n",
  );
  stub.files.set(
    stub.norm(widget),
    CODE_LINES.map((line) => line.map(([text]) => text).join('')).join('\n') + '\n',
  );

  const document = stub.makeDocument(widget);
  const provider = new IconHoverProvider(new Index(ROOT));
  const hover = await provider.provideHover(
    document,
    new stub.VPosition(HOVER_LINE, HOVER_COL + 2),
    { isCancellationRequested: false },
  );
  if (!hover) {
    throw new Error('The hover provider returned nothing — the fixture is wrong.');
  }

  const markdown: string = hover.contents.value;
  const image = /!\[[^\]]*\]\((data:image\/svg\+xml;base64,[^)]+)\)/.exec(markdown);
  const title = /\*\*([^*]+)\*\*/.exec(markdown);
  const alias = /alias of `([^`]+)`/.exec(markdown);
  const setLine = /\n\n([^\n·]+?) &nbsp;·&nbsp; `([^`]+)`\n/.exec(markdown);
  const importedFrom = /Imported from `([^`]+)`/.exec(markdown);
  const link = /\[\$\(replace\) ([^\]]+)\]/.exec(markdown);

  if (!image || !title || !setLine || !importedFrom || !link) {
    throw new Error(`Could not parse the hover markdown:\n${markdown}`);
  }

  return {
    dataUri: image[1],
    title: title[1],
    aliasOf: alias?.[1],
    setLabel: setLine[1].trim(),
    modulePath: setLine[2],
    importedFrom: importedFrom[1],
    linkText: link[1],
  };
}

/** Inline `<code>` as VS Code renders it in a hover: tinted, rounded, monospace. */
function inlineCode(text: string, x: number, y: number, fontSize: number): { svg: string; width: number } {
  const padding = 4;
  const width = text.length * fontSize * 0.6 + padding * 2;
  const svg =
    `<rect x="${x.toFixed(1)}" y="${(y - fontSize * 0.85).toFixed(1)}" width="${width.toFixed(1)}" height="${(fontSize * 1.35).toFixed(1)}" rx="3" fill="${CODE.inlineCodeBackground}"/>` +
    `<text x="${(x + padding).toFixed(1)}" y="${y.toFixed(1)}" font-family="${MONO}" font-size="${(fontSize * 0.92).toFixed(1)}" fill="${CODE.plain}">${escapeXml(text)}</text>`;
  return { svg, width };
}

async function buildHoverShot(): Promise<string> {
  const hover = await captureHover();

  // Wide enough for the longest code line plus a margin; the hover sits well
  // inside that. No point shipping empty canvas.
  const width = 560;
  const codeTop = 18;
  const gutter = 44;
  const codeLeft = gutter + 12;

  // The hover widget sits just below the hovered token, as VS Code places it.
  const hoverX = codeLeft + HOVER_COL * CHAR_W - 8;
  const hoverY = codeTop + (HOVER_LINE + 1) * LINE_H + 6;
  const pad = 12;
  const iconBox = 56;

  const codeParts: string[] = [];
  const parts: string[] = [];

  /* -- editor ------------------------------------------------------------ */
  CODE_LINES.forEach((spans, i) => {
    const y = codeTop + i * LINE_H + CODE_FONT;
    codeParts.push(
      `<text x="${gutter}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="${CODE_FONT}" fill="${CODE.lineNumber}">${i + 1}</text>`,
    );
    if (spans.length === 0) {
      return;
    }
    // One <text> with <tspan> children, not one <text> per span: the renderer
    // then advances by its own real glyph metrics. Positioning each span at a
    // hand-computed x drifts, because the monospace advance width here is not
    // exactly what a hardcoded constant guesses.
    const tspans = spans
      .map(([text, color]) => `<tspan fill="${color}">${escapeXml(text)}</tspan>`)
      .join('');
    codeParts.push(
      `<text x="${codeLeft}" y="${y}" font-family="${MONO}" font-size="${CODE_FONT}" xml:space="preserve">${tspans}</text>`,
    );
  });

  /* -- hover widget ------------------------------------------------------ */
  let cursorY = hoverY + pad;
  // The widget is sized to its content, as VS Code sizes a hover.
  let contentRight = hoverX + pad + iconBox;

  const svgMarkup = Buffer.from(hover.dataUri.split(',')[1], 'base64').toString('utf8');
  // Strip the XML prolog if present, then nest it -- <svg> inside <svg> is valid.
  const nested = svgMarkup
    .replace(/^<\?xml[^>]*\?>/, '')
    .replace('<svg ', `<svg x="${hoverX + pad}" y="${cursorY}" `);
  const iconSvg = nested;
  cursorY += iconBox + 14;

  const titleY = cursorY;
  parts.push(
    `<text x="${hoverX + pad}" y="${titleY}" font-family="${FONT}" font-size="13" font-weight="600" fill="${CODE.plain}">${escapeXml(hover.title)}</text>`,
  );
  contentRight = Math.max(contentRight, hoverX + pad + hover.title.length * 7.6);
  if (hover.aliasOf) {
    const offset = hover.title.length * 7.6 + 10;
    contentRight = Math.max(contentRight, hoverX + pad + offset + (hover.aliasOf.length + 10) * 6.2);
    parts.push(
      `<text x="${hoverX + pad + offset}" y="${titleY}" font-family="${FONT}" font-size="12" fill="${THEME.description}">· alias of ${escapeXml(hover.aliasOf)}</text>`,
    );
  }
  cursorY += 22;

  parts.push(
    `<text x="${hoverX + pad}" y="${cursorY}" font-family="${FONT}" font-size="12.5" fill="${CODE.plain}">${escapeXml(hover.setLabel)}</text>`,
  );
  const setWidth = hover.setLabel.length * 6.6 + 8;
  parts.push(
    `<text x="${hoverX + pad + setWidth}" y="${cursorY}" font-family="${FONT}" font-size="12.5" fill="${THEME.description}">·</text>`,
  );
  const modulePathCode = inlineCode(hover.modulePath, hoverX + pad + setWidth + 14, cursorY, 12.5);
  parts.push(modulePathCode.svg);
  contentRight = Math.max(contentRight, hoverX + pad + setWidth + 14 + modulePathCode.width);
  cursorY += 24;

  parts.push(
    `<text x="${hoverX + pad}" y="${cursorY}" font-family="${FONT}" font-size="12.5" fill="${CODE.plain}">Imported from</text>`,
  );
  const fromCode = inlineCode(hover.importedFrom, hoverX + pad + 88, cursorY, 12.5);
  parts.push(fromCode.svg);
  contentRight = Math.max(contentRight, hoverX + pad + 88 + fromCode.width);
  cursorY += 26;

  parts.push(
    `<text x="${hoverX + pad}" y="${cursorY}" font-family="${FONT}" font-size="12.5" fill="${CODE.link}">⟳ ${escapeXml(hover.linkText)}</text>`,
  );
  cursorY += pad + 4;

  const hoverH = cursorY - hoverY;
  const hoverW = contentRight - hoverX + pad;
  const height = Math.max(hoverY + hoverH + 20, codeTop + CODE_LINES.length * LINE_H + 20);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height.toFixed(0)}" viewBox="0 0 ${width} ${height.toFixed(0)}">
    <rect width="${width}" height="${height.toFixed(0)}" fill="${CODE.background}"/>
    ${codeParts.join('')}
    <rect x="${hoverX}" y="${hoverY}" width="${hoverW}" height="${hoverH.toFixed(1)}" rx="3" fill="${CODE.hoverBackground}" stroke="${CODE.hoverBorder}"/>
    ${iconSvg}
    ${parts.join('')}
  </svg>`;
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

  // Last, because installing the `vscode` stub mutates module resolution.
  const hoverSvg = await buildHoverShot();
  if (process.env.DUMP_SVG) {
    require('node:fs').writeFileSync(process.env.DUMP_SVG, hoverSvg, 'utf8');
  }
  const hoverInfo = await sharp(Buffer.from(hoverSvg), { density: 144 })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, 'screenshot-hover.png'));
  console.log(
    `media/${'screenshot-hover.png'.padEnd(28)} ${hoverInfo.width}x${hoverInfo.height}, ${(hoverInfo.size / 1024).toFixed(0)} KB`,
  );
}

void main();
