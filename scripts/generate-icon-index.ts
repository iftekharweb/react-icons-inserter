/**
 * Build-time icon index generator.
 *
 * WHY THIS EXISTS
 * ---------------
 * `react-icons` ships no searchable index: every subset is an auto-generated
 * CommonJS module full of `GenIcon({...})(props)` factories. Regex-parsing those
 * files is brittle (the embedded JSON trees contain escaped quotes, nested
 * children, per-set attribute quirks). Instead we do the only thing that is
 * guaranteed to match what the user will actually see at runtime: we *render*
 * every icon with `react-dom/server` and capture the resulting SVG markup.
 *
 * This script runs at development time only. Neither `react-icons`, `react` nor
 * `react-dom` is a runtime dependency of the published extension -- the SVG data
 * is pre-baked into `assets/icon-index/` and shipped as static JSON.
 *
 * OUTPUT LAYOUT (all under assets/icon-index/)
 *   manifest.json      -> set metadata + counts + licenses (tiny, always loaded)
 *   names.json         -> { setId: [iconName, ...] }        (light, always loaded)
 *   svg/<setId>.json   -> { iconName: [viewBox, innerSvg] } (heavy, lazy loaded)
 *
 * Splitting names from SVG bodies is the whole point: activation only needs
 * names, and a single set's SVG payload is only read when an icon from that set
 * is actually previewed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderToStaticMarkup } = require('react-dom/server');

const ROOT = path.resolve(__dirname, '..');
const REACT_ICONS_DIR = path.join(ROOT, 'node_modules', 'react-icons');
const OUT_DIR = path.join(ROOT, 'assets', 'icon-index');
const SVG_DIR = path.join(OUT_DIR, 'svg');

interface ManifestEntry {
  id: string;
  name: string;
  projectUrl?: string;
  license?: string;
  licenseUrl?: string;
}

interface SetSummary extends ManifestEntry {
  count: number;
}

/** Pull `viewBox` and the inner markup out of a rendered `<svg ...>...</svg>`. */
function splitSvg(markup: string): { viewBox: string; body: string } | undefined {
  const open = markup.indexOf('>');
  const close = markup.lastIndexOf('</svg>');
  if (open === -1 || close === -1 || close < open) {
    return undefined;
  }
  const head = markup.slice(0, open);
  const viewBoxMatch = /viewBox="([^"]*)"/.exec(head);
  return {
    // Not every set declares a viewBox; fall back to the react-icons default box.
    viewBox: viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24',
    body: markup.slice(open + 1, close),
  };
}

function loadManifest(): ManifestEntry[] {
  // The manifest is not reachable through the package `exports` map, so resolve
  // the file directly. This is a build script -- reaching into node_modules is fine.
  const mod = require(path.join(REACT_ICONS_DIR, 'lib', 'iconsManifest.js'));
  return mod.IconsManifest ?? mod.default ?? mod;
}

function main(): void {
  const started = Date.now();
  const reactIconsVersion = JSON.parse(
    fs.readFileSync(path.join(REACT_ICONS_DIR, 'package.json'), 'utf8'),
  ).version as string;

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SVG_DIR, { recursive: true });

  const manifest = loadManifest();
  const names: Record<string, string[]> = {};
  const sets: SetSummary[] = [];
  let total = 0;
  let skipped = 0;

  for (const entry of manifest) {
    const setEntry = path.join(REACT_ICONS_DIR, entry.id, 'index.js');
    if (!fs.existsSync(setEntry)) {
      console.warn(`  ! skipping ${entry.id}: ${setEntry} not found`);
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const iconModule = require(setEntry) as Record<string, React.ComponentType>;
    const svgData: Record<string, [string, string]> = {};
    const setNames: string[] = [];

    for (const iconName of Object.keys(iconModule)) {
      const component = iconModule[iconName];
      if (typeof component !== 'function') {
        continue;
      }
      let markup: string;
      try {
        markup = renderToStaticMarkup(React.createElement(component));
      } catch (error) {
        skipped++;
        console.warn(`  ! ${entry.id}/${iconName} failed to render: ${String(error)}`);
        continue;
      }
      const parsed = splitSvg(markup);
      if (!parsed) {
        skipped++;
        continue;
      }
      setNames.push(iconName);
      svgData[iconName] = [parsed.viewBox, parsed.body];
    }

    setNames.sort();
    names[entry.id] = setNames;
    sets.push({ ...entry, count: setNames.length });
    total += setNames.length;

    fs.writeFileSync(
      path.join(SVG_DIR, `${entry.id}.json`),
      JSON.stringify(svgData),
      'utf8',
    );
    console.log(`  ${entry.id.padEnd(5)} ${String(setNames.length).padStart(6)} icons`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'names.json'), JSON.stringify(names), 'utf8');
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        indexVersion: 1,
        generatedAt: new Date().toISOString(),
        reactIconsVersion,
        total,
        sets,
      },
      null,
      2,
    ),
    'utf8',
  );

  const namesBytes = fs.statSync(path.join(OUT_DIR, 'names.json')).size;
  const svgBytes = fs
    .readdirSync(SVG_DIR)
    .reduce((sum, file) => sum + fs.statSync(path.join(SVG_DIR, file)).size, 0);

  console.log('');
  console.log(`react-icons     ${reactIconsVersion}`);
  console.log(`sets            ${sets.length}`);
  console.log(`icons           ${total}${skipped ? ` (${skipped} skipped)` : ''}`);
  console.log(`names.json      ${(namesBytes / 1024).toFixed(0)} KB (loaded at activation)`);
  console.log(`svg/*.json      ${(svgBytes / 1024 / 1024).toFixed(1)} MB (lazy, per set)`);
  console.log(`took            ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main();
