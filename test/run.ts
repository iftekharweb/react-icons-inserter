/**
 * Test suite. Run with `npm test`.
 *
 * Covers the three things that are easy to get subtly wrong and expensive to
 * debug by hand in an Extension Host: the barrel file's contents, the active
 * file's import merging, and the hover's import verification.
 */
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  commit,
  editorFor,
  files,
  installVscodeStub,
  makeDocument,
  messages,
  norm,
  reset,
  VPosition,
} from './vscodeStub';

installVscodeStub();

// Required *after* the stub is installed -- these modules import `vscode`.
const SRC = path.join(__dirname, '..', 'src');
/* eslint-disable @typescript-eslint/no-var-requires */
const { planBarrelUpdate, barrelSpecifierFrom } = require(path.join(SRC, 'barrelFile'));
const { planNamedImport, specifierPointsAtBarrel, insertIcon } = require(
  path.join(SRC, 'importManager'),
);
const { IconHoverProvider } = require(path.join(SRC, 'hoverProvider'));
const { IconIndex } = require(path.join(SRC, 'iconIndex'));
/* eslint-enable @typescript-eslint/no-var-requires */

const EXTENSION_ROOT = path.join(__dirname, '..');

let passed = 0;
const failures: string[] = [];

async function test(name: string, body: () => void | Promise<void>): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL  ${name}`);
    console.log(String(error instanceof Error ? error.stack : error).replace(/^/gm, '      '));
  }
}

const BARREL = {
  fsPath: 'C:\\proj\\icons\\react-icons.ts',
  language: 'ts' as const,
  exists: true,
  ambiguous: false,
};
const BARREL_KEY = norm(BARREL.fsPath);

const faBeer = { name: 'FaBeer', set: 'fa', setLabel: 'Font Awesome 5', modulePath: 'react-icons/fa' };
const mdHome = { name: 'MdHome', set: 'md', setLabel: 'Material Design', modulePath: 'react-icons/md' };
const faBook = {
  name: 'FaAddressBook',
  set: 'fa',
  setLabel: 'Font Awesome 5',
  modulePath: 'react-icons/fa',
};
const fa6Book = {
  name: 'FaAddressBook',
  set: 'fa6',
  setLabel: 'Font Awesome 6',
  modulePath: 'react-icons/fa6',
};

async function main(): Promise<void> {
  console.log('\nbarrel file');

  await test('creates a sorted barrel from nothing', () => {
    const plan = planBarrelUpdate(BARREL, '', faBeer, 'set');
    assert.equal(plan.changed, true);
    assert.equal(plan.exportedName, 'FaBeer');
    assert.match(plan.newText, /export \{ FaBeer \} from 'react-icons\/fa';/);
  });

  await test('keeps re-exports ordered by source set', () => {
    let plan = planBarrelUpdate(BARREL, '', mdHome, 'set');
    plan = planBarrelUpdate(BARREL, plan.newText, faBeer, 'set');
    assert.ok(plan.newText.indexOf("react-icons/fa'") < plan.newText.indexOf("react-icons/md'"));
  });

  await test('is a no-op for an icon already re-exported', () => {
    const first = planBarrelUpdate(BARREL, '', faBeer, 'set');
    const again = planBarrelUpdate(BARREL, first.newText, faBeer, 'set');
    assert.equal(again.changed, false);
    assert.equal(again.newText, first.newText);
  });

  await test('keeps both sides of a cross-set name collision, aliasing the newcomer', () => {
    const first = planBarrelUpdate(BARREL, '', faBook, 'set');
    const clash = planBarrelUpdate(BARREL, first.newText, fa6Book, 'set');
    assert.equal(clash.exportedName, 'FaAddressBookFa6');
    assert.equal(clash.collisionWith, 'react-icons/fa');
    assert.match(clash.newText, /export \{ FaAddressBook \} from 'react-icons\/fa';/);
    assert.match(
      clash.newText,
      /export \{ FaAddressBook as FaAddressBookFa6 \} from 'react-icons\/fa6';/,
    );
  });

  await test('appends instead of regenerating when the barrel has hand-written code', () => {
    const impure = "export const size = 24;\nexport { FaBeer } from 'react-icons/fa';\n";
    const plan = planBarrelUpdate(BARREL, impure, mdHome, 'set');
    assert.match(plan.newText, /export const size = 24;/);
    assert.match(plan.newText, /MdHome/);
  });

  console.log('\nrelative specifiers');

  await test('computes the specifier from any depth, with forward slashes', () => {
    assert.equal(
      barrelSpecifierFrom('C:\\proj\\src\\a\\b\\Widget.tsx', BARREL.fsPath),
      '../../../icons/react-icons',
    );
    assert.equal(barrelSpecifierFrom('C:\\proj\\icons\\Other.tsx', BARREL.fsPath), './react-icons');
  });

  await test('recognises equivalent specifiers, rejects unrelated ones', () => {
    const from = 'C:\\proj\\src\\Widget.tsx';
    assert.equal(specifierPointsAtBarrel(from, '../icons/react-icons', BARREL.fsPath), true);
    assert.equal(specifierPointsAtBarrel(from, '../icons/react-icons.ts', BARREL.fsPath), true);
    assert.equal(specifierPointsAtBarrel(from, './other', BARREL.fsPath), false);
    assert.equal(specifierPointsAtBarrel(from, 'react-icons/fa', BARREL.fsPath), false);
  });

  console.log('\nimport planning');

  const file = 'C:\\proj\\src\\Widget.tsx';
  const spec = '../icons/react-icons';
  const apply = (text: string, edit: { start: number; end: number; newText: string }): string =>
    text.slice(0, edit.start) + edit.newText + text.slice(edit.end);

  await test('adds an import after the existing ones', () => {
    const text = "import React from 'react';\n\nexport const W = () => <div />;\n";
    const result = apply(text, planNamedImport(file, text, 'FaBeer', spec, BARREL.fsPath));
    assert.match(result, /import \{ FaBeer \} from '\.\.\/icons\/react-icons';/);
    assert.match(result, /export const W/);
  });

  await test('merges into the existing barrel import without corrupting the file', () => {
    const text =
      "import React from 'react';\nimport { FaBeer } from '../icons/react-icons';\n\nexport const W = () => <div />;\n";
    const result = apply(text, planNamedImport(file, text, 'MdHome', spec, BARREL.fsPath));
    assert.match(result, /import \{ FaBeer, MdHome \} from '\.\.\/icons\/react-icons';/);
    assert.equal((result.match(/icons\/react-icons/g) ?? []).length, 1);
    assert.match(result, /^import React from 'react';\n/);
    assert.match(result, /\nexport const W = \(\) => <div \/>;\n$/);
  });

  await test('returns no edit when the name is already imported', () => {
    const text = "import { MdHome } from '../icons/react-icons';\n";
    assert.equal(planNamedImport(file, text, 'MdHome', spec, BARREL.fsPath), undefined);
  });

  await test('merges into an import written with a file extension', () => {
    const text = "import { FaBeer } from '../icons/react-icons.ts';\n";
    const edit = planNamedImport(file, text, 'MdHome', spec, BARREL.fsPath);
    assert.match(edit.newText, /\{ FaBeer, MdHome \}/);
  });

  await test('places the import after a "use client" directive', () => {
    const text = "'use client';\n\nexport const W = () => <div />;\n";
    const result = apply(text, planNamedImport(file, text, 'FaBeer', spec, BARREL.fsPath));
    assert.ok(result.indexOf("'use client'") < result.indexOf('import {'));
  });

  await test('respects a double-quoted codebase', () => {
    const text = 'import React from "react";\n';
    const edit = planNamedImport(file, text, 'FaBeer', spec, BARREL.fsPath);
    assert.match(edit.newText, /from "\.\.\/icons\/react-icons";/);
  });

  console.log('\ninsert (barrel + import + JSX in one edit)');

  const widget = 'C:\\proj\\src\\features\\Widget.tsx';
  reset();
  files.set(norm('C:\\proj\\tsconfig.json'), '{}');
  files.set(norm(widget), "import React from 'react';\n\nexport const Widget = () => (\n  <div></div>\n);\n");

  await test('creates the barrel as .ts, adds the import and the JSX', async () => {
    const caret = files.get(norm(widget))!.indexOf('<div>') + '<div>'.length;
    const result = await insertIcon(editorFor(widget, caret), faBeer);
    assert.ok(result);
    assert.equal(result.createdBarrel, true);
    commit();
    assert.ok(files.has(BARREL_KEY), 'barrel created as .ts because tsconfig.json exists');
    const text = files.get(norm(widget))!;
    assert.match(text, /import \{ FaBeer \} from '\.\.\/\.\.\/icons\/react-icons';/);
    assert.match(text, /<div><FaBeer \/><\/div>/);
    assert.doesNotMatch(text, /react-icons\/fa/, 'components never import react-icons directly');
    assert.match(files.get(BARREL_KEY)!, /export \{ FaBeer \} from 'react-icons\/fa';/);
  });

  await test('merges the second icon into the same import', async () => {
    await insertIcon(editorFor(widget, files.get(norm(widget))!.indexOf('</div>')), mdHome);
    commit();
    const text = files.get(norm(widget))!;
    assert.match(text, /import \{ FaBeer, MdHome \} from '\.\.\/\.\.\/icons\/react-icons';/);
    assert.equal((text.match(/icons\/react-icons/g) ?? []).length, 1);
  });

  await test('re-inserting a known icon leaves the barrel and import untouched', async () => {
    const before = files.get(BARREL_KEY);
    await insertIcon(editorFor(widget, files.get(norm(widget))!.indexOf('</div>')), faBeer);
    commit();
    assert.equal(files.get(BARREL_KEY), before);
    assert.equal((files.get(norm(widget))!.match(/icons\/react-icons/g) ?? []).length, 1);
  });

  await test('a collision is aliased end to end and warns the user', async () => {
    await insertIcon(editorFor(widget, files.get(norm(widget))!.indexOf('</div>')), faBook);
    commit();
    const result = await insertIcon(
      editorFor(widget, files.get(norm(widget))!.indexOf('</div>')),
      fa6Book,
    );
    commit();
    assert.equal(result.exportedName, 'FaAddressBookFa6');
    assert.match(files.get(norm(widget))!, /<FaAddressBookFa6 \/>/);
    assert.match(files.get(norm(widget))!, /FaAddressBook, FaAddressBookFa6/);
    assert.ok(
      messages.some((m) => m.includes('Added it as FaAddressBookFa6')),
      'user is told about the collision',
    );
  });

  await test('running inside the barrel adds the re-export and never self-imports', async () => {
    const before = files.get(BARREL_KEY)!;
    const result = await insertIcon(editorFor(BARREL.fsPath, before.length), {
      name: 'FiFeather',
      set: 'fi',
      setLabel: 'Feather',
      modulePath: 'react-icons/fi',
    });
    commit();
    assert.equal(result.inserted, false, 'no JSX is written into the barrel');
    const after = files.get(BARREL_KEY)!;
    assert.match(after, /export \{ FiFeather \} from 'react-icons\/fi';/);
    assert.doesNotMatch(after, /^import /m, 'the barrel must not import itself');
  });

  console.log('\nhover');

  const index = new IconIndex(EXTENSION_ROOT);
  const provider = new IconHoverProvider(index);
  const liveToken = { isCancellationRequested: false };
  const document = makeDocument(widget);
  const lines = files.get(norm(widget))!.split('\n');

  await test('previews an aliased icon, resolving it back to its real set', async () => {
    const line = lines.findIndex((l) => l.includes('<FaAddressBookFa6'));
    const column = lines[line].indexOf('FaAddressBookFa6') + 2;
    const hover = await provider.provideHover(document, new VPosition(line, column), liveToken);
    assert.ok(hover, 'aliased barrel icons must hover');
    const markdown = (hover.contents as { value: string }).value;
    assert.match(markdown, /!\[FaAddressBook\]\(data:image\/svg\+xml;base64,/);
    assert.match(markdown, /alias of `FaAddressBook`/);
    assert.match(markdown, /Font Awesome 6/);
    assert.match(markdown, /command:reactIcons\.replaceAtCursor\?/);
  });

  await test('previews a plain barrel icon', async () => {
    const line = lines.findIndex((l) => l.includes('<FaBeer'));
    const column = lines[line].indexOf('FaBeer') + 2;
    const hover = await provider.provideHover(document, new VPosition(line, column), liveToken);
    assert.ok(hover);
    assert.match((hover.contents as { value: string }).value, /Font Awesome 5/);
  });

  await test('ignores identifiers that are not barrel imports', async () => {
    const line = lines.findIndex((l) => l.includes("from 'react'"));
    const column = lines[line].indexOf('React') + 1;
    assert.equal(
      await provider.provideHover(document, new VPosition(line, column), liveToken),
      undefined,
    );
  });

  console.log('\nicon index');

  await test('loads, searches and renders previews', async () => {
    await index.load();
    assert.ok(index.iconCount > 40000, `expected a full index, got ${index.iconCount}`);
    assert.equal(index.search('beer', 10).icons[0].name.endsWith('Beer'), true);
    assert.equal(index.search('FaBeer', 10).icons[0].name, 'FaBeer');
    assert.equal(index.search('xyzzyplugh', 10).total, 0);
    // "arrl" must still reach arrow-left style names through the fuzzy tier.
    assert.ok(
      index.search('arrl', 20).icons.some((i: { name: string }) => /Arrow/.test(i.name)),
      'fuzzy tier should find arrow icons for "arrl"',
    );
    const uri = await index.getDataUri(faBeer, 16, '#ccc');
    assert.match(uri, /^data:image\/svg\+xml;base64,/);
  });

  await test('search respects cancellation', () => {
    const cancelled = index.search('beer', 10, { isCancellationRequested: true });
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.icons.length, 0);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

void main();
