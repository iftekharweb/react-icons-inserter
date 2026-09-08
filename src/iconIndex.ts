import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Fuse from 'fuse.js';

/** One icon, as returned by search / hover lookups. */
export interface IconRef {
  /** Exported symbol, e.g. `FaBeer`. */
  name: string;
  /** react-icons subset id, e.g. `fa`. */
  set: string;
  /** Human readable set name, e.g. `Font Awesome 5`. */
  setLabel: string;
  /** Import path a barrel re-export must use, e.g. `react-icons/fa`. */
  modulePath: string;
}

export interface IconSetMeta {
  id: string;
  name: string;
  projectUrl?: string;
  license?: string;
  licenseUrl?: string;
  count: number;
}

interface IndexManifest {
  indexVersion: number;
  generatedAt: string;
  reactIconsVersion: string;
  total: number;
  sets: IconSetMeta[];
}

/** `[viewBox, innerSvgMarkup]` -- the shape written by scripts/generate-icon-index.ts. */
export type SvgRecord = [string, string];

export interface SearchResult {
  /** At most `limit` icons, best matches first. */
  icons: IconRef[];
  /** How many icons matched in total, so the UI can say "showing 50 of 312". */
  total: number;
  /** The scan was abandoned because a newer query superseded it. */
  cancelled: boolean;
}

const NON_ALNUM = /[^a-z0-9]+/g;

function normalize(value: string): string {
  return value.toLowerCase().replace(NON_ALNUM, '');
}

/** Does every char of `needle` appear in `haystack`, in order? Powers "arrl" -> "arrowleft". */
function isSubsequence(haystack: string, needle: string): boolean {
  let n = 0;
  for (let h = 0; h < haystack.length && n < needle.length; h++) {
    if (haystack.charCodeAt(h) === needle.charCodeAt(n)) {
      n++;
    }
  }
  return n === needle.length;
}

/**
 * Loads and searches the pre-baked icon index that ships in `assets/icon-index/`.
 *
 * PERFORMANCE MODEL
 * -----------------
 * Three tiers, loaded independently:
 *   1. `manifest.json` (~4 KB)  -- set metadata. Loaded with the name index.
 *   2. `names.json` (~840 KB)   -- every icon name, grouped by set. Loaded once,
 *      lazily, on the first search or hover. Never during activate().
 *   3. `svg/<set>.json` (0.1-6 MB) -- SVG bodies. Loaded per set, only when an
 *      icon from that set is actually previewed, then cached for the session.
 *
 * SEARCH
 * ------
 * A plain `Fuse` index over all ~51k names measured 65-160 ms per query -- far
 * too slow to run behind a 120 ms debounce without stuttering the extension
 * host. So search is two-stage:
 *   a) a tight typed loop classifies names into match tiers (exact / prefix /
 *      substring / subsequence). ~3-12 ms over 51k names, no index to build.
 *   b) `fuse.js` ranks *only* the fuzzy (subsequence) tier, capped at
 *      FUZZY_CANDIDATE_CAP items, which keeps ranking in the 2-10 ms range.
 * Exact and substring hits keep deterministic ordering (shortest name first)
 * rather than being re-shuffled by fuzzy scores -- typing "beer" should surface
 * `FaBeer` above `CiBeerMugFull`, which pure Fuse scoring does not do.
 */
export class IconIndex {
  private readonly assetsDir: string;

  private manifest?: IndexManifest;
  private readonly setMeta = new Map<string, IconSetMeta>();

  /**
   * Parallel arrays -- one entry per icon. Flat string arrays beat an array of
   * 51k small objects on both memory and GC pressure, and the hot search loop
   * only ever touches the two normalised name arrays.
   */
  private names: string[] = [];
  private setIds: string[] = [];
  /** Name minus its set prefix, lowercased, punctuation stripped: `FaBeer` -> `beer`. */
  private bareNames: string[] = [];
  /** Full name, normalised: `FaBeer` -> `fabeer`. Lets users paste exact names. */
  private fullNames: string[] = [];

  /** Built lazily -- only the hover provider needs name -> icon resolution. */
  private byName?: Map<string, IconRef[]>;

  private namesPromise?: Promise<void>;
  private readonly svgSets = new Map<string, Record<string, SvgRecord>>();
  private readonly svgSetPromises = new Map<string, Promise<Record<string, SvgRecord>>>();
  /** Session cache of rendered data URIs, keyed by `set/name/size/colour`. */
  private readonly dataUriCache = new Map<string, string>();

  private static readonly FUZZY_CANDIDATE_CAP = 2000;

  constructor(extensionPath: string) {
    this.assetsDir = path.join(extensionPath, 'assets', 'icon-index');
  }

  /** Idempotent; concurrent callers share a single load. */
  load(): Promise<void> {
    if (!this.namesPromise) {
      this.namesPromise = this.loadNames();
    }
    return this.namesPromise;
  }

  get isLoaded(): boolean {
    return this.names.length > 0;
  }

  get iconCount(): number {
    return this.names.length;
  }

  get sets(): IconSetMeta[] {
    return this.manifest?.sets ?? [];
  }

  get reactIconsVersion(): string {
    return this.manifest?.reactIconsVersion ?? 'unknown';
  }

  private async loadNames(): Promise<void> {
    const [manifestRaw, namesRaw] = await Promise.all([
      fs.readFile(path.join(this.assetsDir, 'manifest.json'), 'utf8'),
      fs.readFile(path.join(this.assetsDir, 'names.json'), 'utf8'),
    ]);

    this.manifest = JSON.parse(manifestRaw) as IndexManifest;
    for (const set of this.manifest.sets) {
      this.setMeta.set(set.id, set);
    }

    const grouped = JSON.parse(namesRaw) as Record<string, string[]>;
    for (const [setId, iconNames] of Object.entries(grouped)) {
      const prefixLength = IconIndex.prefixLengthFor(setId, iconNames[0]);
      for (const iconName of iconNames) {
        this.names.push(iconName);
        this.setIds.push(setId);
        this.bareNames.push(normalize(iconName.slice(prefixLength)));
        this.fullNames.push(normalize(iconName));
      }
    }
  }

  /**
   * react-icons prefixes every export with a per-set marker (`Fa*`, `Md*`, and
   * `io5` still emits `Io*`). Derive the prefix from the set id and verify it
   * against a sample name instead of hardcoding a 31-entry table.
   */
  private static prefixLengthFor(setId: string, sample: string | undefined): number {
    if (!sample) {
      return 0;
    }
    for (const candidate of [setId, setId.replace(/\d+$/, '')]) {
      const prefix = candidate.charAt(0).toUpperCase() + candidate.slice(1);
      if (sample.startsWith(prefix)) {
        return prefix.length;
      }
    }
    return 0;
  }

  private toRef(index: number): IconRef {
    const setId = this.setIds[index];
    return {
      name: this.names[index],
      set: setId,
      setLabel: this.setMeta.get(setId)?.name ?? setId,
      modulePath: `react-icons/${setId}`,
    };
  }

  /**
   * @param query raw user input; case and punctuation are ignored
   * @param limit maximum results to return
   * @param token checked periodically so a superseded keystroke abandons its
   *              scan rather than finishing it
   */
  search(query: string, limit: number, token?: { isCancellationRequested: boolean }): SearchResult {
    const normalized = normalize(query);
    if (!normalized) {
      // Empty query: a cheap deterministic sample beats scanning 51k names.
      const sample: IconRef[] = [];
      for (let i = 0; i < this.names.length && sample.length < limit; i++) {
        sample.push(this.toRef(i));
      }
      return { icons: sample, total: this.names.length, cancelled: false };
    }

    const exact: number[] = [];
    const prefix: number[] = [];
    const substring: number[] = [];
    const fuzzy: number[] = [];

    for (let i = 0; i < this.bareNames.length; i++) {
      // Cancellation is polled in blocks: reading the flag 51k times is itself
      // measurable, reading it once every 4096 icons is not.
      if ((i & 0xfff) === 0 && token?.isCancellationRequested) {
        return { icons: [], total: 0, cancelled: true };
      }
      // Both forms are tested so "beer" and the pasted "FaBeer" both land.
      const bare = this.bareNames[i];
      const full = this.fullNames[i];
      if (bare === normalized || full === normalized) {
        exact.push(i);
      } else if (bare.startsWith(normalized) || full.startsWith(normalized)) {
        prefix.push(i);
      } else if (bare.includes(normalized) || full.includes(normalized)) {
        substring.push(i);
      } else if (fuzzy.length < IconIndex.FUZZY_CANDIDATE_CAP && isSubsequence(full, normalized)) {
        fuzzy.push(i);
      }
    }

    const byLengthThenName = (a: number, b: number): number =>
      this.names[a].length - this.names[b].length || this.names[a].localeCompare(this.names[b]);

    exact.sort(byLengthThenName);
    prefix.sort(byLengthThenName);
    substring.sort(byLengthThenName);

    const ordered = [...exact, ...prefix, ...substring];
    const total = ordered.length + fuzzy.length;
    if (ordered.length >= limit || fuzzy.length === 0) {
      return {
        icons: ordered.slice(0, limit).map((i) => this.toRef(i)),
        total,
        cancelled: false,
      };
    }

    // Only the leftovers reach fuse.js -- a small, bounded candidate set.
    const candidates = fuzzy.map((i) => ({ i, n: this.fullNames[i] }));
    const fuse = new Fuse(candidates, {
      keys: ['n'],
      threshold: 0.45,
      ignoreLocation: true,
      minMatchCharLength: Math.min(2, normalized.length),
    });
    for (const hit of fuse.search(normalized, { limit: limit - ordered.length })) {
      ordered.push(hit.item.i);
    }

    return {
      icons: ordered.slice(0, limit).map((i) => this.toRef(i)),
      total,
      cancelled: false,
    };
  }

  /** Every icon carrying this exact export name (a name can exist in several sets). */
  resolveByName(name: string): IconRef[] {
    if (!this.byName) {
      this.byName = new Map();
      for (let i = 0; i < this.names.length; i++) {
        const existing = this.byName.get(this.names[i]);
        if (existing) {
          existing.push(this.toRef(i));
        } else {
          this.byName.set(this.names[i], [this.toRef(i)]);
        }
      }
    }
    return this.byName.get(name) ?? [];
  }

  private loadSvgSet(setId: string): Promise<Record<string, SvgRecord>> {
    const cached = this.svgSets.get(setId);
    if (cached) {
      return Promise.resolve(cached);
    }
    let pending = this.svgSetPromises.get(setId);
    if (!pending) {
      pending = fs
        .readFile(path.join(this.assetsDir, 'svg', `${setId}.json`), 'utf8')
        .then((raw) => {
          const parsed = JSON.parse(raw) as Record<string, SvgRecord>;
          this.svgSets.set(setId, parsed);
          this.svgSetPromises.delete(setId);
          return parsed;
        })
        .catch((error) => {
          this.svgSetPromises.delete(setId);
          throw error;
        });
      this.svgSetPromises.set(setId, pending);
    }
    return pending;
  }

  /** Raw `[viewBox, innerSvg]` for one icon, loading its set on demand. */
  async getSvg(icon: IconRef): Promise<SvgRecord | undefined> {
    const set = await this.loadSvgSet(icon.set);
    return set[icon.name];
  }

  /**
   * Standalone SVG markup for a preview. `color` must be a literal CSS colour:
   * VS Code renders these outside any theme CSS scope, so the `currentColor`
   * that react-icons emits at runtime would come out invisible here.
   */
  async getSvgMarkup(icon: IconRef, size: number, color: string): Promise<string | undefined> {
    const record = await this.getSvg(icon);
    if (!record) {
      return undefined;
    }
    const [viewBox, body] = record;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
      `width="${size}" height="${size}" fill="${color}" stroke="${color}" stroke-width="0">` +
      `${body}</svg>`
    );
  }

  /** Base64 `data:` URI for a preview, cached per (icon, size, colour). */
  async getDataUri(icon: IconRef, size: number, color: string): Promise<string | undefined> {
    const key = `${icon.set}/${icon.name}/${size}/${color}`;
    const cached = this.dataUriCache.get(key);
    if (cached) {
      return cached;
    }
    const markup = await this.getSvgMarkup(icon, size, color);
    if (!markup) {
      return undefined;
    }
    const uri = `data:image/svg+xml;base64,${Buffer.from(markup, 'utf8').toString('base64')}`;
    this.dataUriCache.set(key, uri);
    return uri;
  }

  /** Drop the heavy per-set SVG payloads; the name arrays stay resident. */
  dispose(): void {
    this.svgSets.clear();
    this.svgSetPromises.clear();
    this.dataUriCache.clear();
  }
}
