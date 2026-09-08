/**
 * Generates the Marketplace icon at `media/icon.png`.
 *
 * The mark is a 2x2 grid of icons with one accent "insert" tile -- which is
 * literally what the extension does, and mirrors the grid picker. The three
 * glyphs are pulled from this repo's own generated index rather than hand-copied
 * path data, so they are guaranteed to be the real artwork and the icon can be
 * regenerated after a `react-icons` upgrade.
 *
 *   npm run generate-branding      (requires `npm run generate-index` first)
 *
 * Development-time only. `sharp` is a devDependency and does not ship.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(__dirname, '..');
const INDEX_DIR = path.join(ROOT, 'assets', 'icon-index', 'svg');
const OUT_DIR = path.join(ROOT, 'media');

const SIZE = 128;
const CORNER = 26;
const PAD = 21;
const TILE = 35;
const GAP = 15;
const GLYPH = 28;

/** Which icons make up the mark. Recognisable at 32px, varied in silhouette. */
const GLYPHS: { set: string; name: string }[] = [
  { set: 'fa', name: 'FaStar' },
  { set: 'fa', name: 'FaHeart' },
  { set: 'fa', name: 'FaBolt' },
];

type SvgRecord = [viewBox: string, body: string];

function loadGlyph(set: string, name: string): SvgRecord {
  const file = path.join(INDEX_DIR, `${set}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file} — run "npm run generate-index" first.`);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, SvgRecord>;
  const record = data[name];
  if (!record) {
    throw new Error(`${name} not found in set "${set}".`);
  }
  return record;
}

/** Place a glyph in its tile, scaled to fit and centred on the tile's midpoint. */
function placeGlyph(record: SvgRecord, cx: number, cy: number, fill: string): string {
  const [viewBox, body] = record;
  const [minX, minY, width, height] = viewBox.split(/\s+/).map(Number);
  const scale = GLYPH / Math.max(width, height);
  const x = cx - (width * scale) / 2 - minX * scale;
  const y = cy - (height * scale) / 2 - minY * scale;
  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})" fill="${fill}">${body}</g>`;
}

function buildSvg(): string {
  const centres = [
    [PAD + TILE / 2, PAD + TILE / 2],
    [PAD + TILE + GAP + TILE / 2, PAD + TILE / 2],
    [PAD + TILE / 2, PAD + TILE + GAP + TILE / 2],
    [PAD + TILE + GAP + TILE / 2, PAD + TILE + GAP + TILE / 2],
  ];

  const glyphs = GLYPHS.map((glyph, i) =>
    placeGlyph(loadGlyph(glyph.set, glyph.name), centres[i][0], centres[i][1], '#E8EDF5'),
  ).join('');

  // Fourth tile: the accent "insert" affordance.
  const [px, py] = centres[3];
  const arm = 11.5;
  const thickness = 4;
  const plus =
    `<rect x="${px - arm}" y="${py - thickness / 2}" width="${arm * 2}" height="${thickness}" rx="${thickness / 2}" fill="#0B0F16"/>` +
    `<rect x="${px - thickness / 2}" y="${py - arm}" width="${thickness}" height="${arm * 2}" rx="${thickness / 2}" fill="#0B0F16"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2A3347"/>
      <stop offset="1" stop-color="#141922"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" fill="url(#bg)"/>
  <circle cx="${px}" cy="${py}" r="${TILE / 2}" fill="#61DAFB"/>
  ${glyphs}
  ${plus}
</svg>`;
}

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const svg = buildSvg();
  const svgPath = path.join(OUT_DIR, 'icon.svg');
  fs.writeFileSync(svgPath, svg, 'utf8');

  void sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, 'icon.png'))
    .then((info) => {
      console.log(`media/icon.svg  ${svg.length} bytes`);
      console.log(`media/icon.png  ${info.width}x${info.height}, ${info.size} bytes`);
    });
}

main();
