import { prints, type PrintEntry } from './prints';

export type SlotId = 'left' | 'middle' | 'right';

export type CelebrationPrint = {
  /** Stable identity for this print, derived from its filename stem (e.g.
   *  'birthday-sarah.jpg' -> 'birthday-sarah'). Used as the collected-set key, the
   *  find-by-id lookup, and the thumbnail target — so it must be unique and stable. */
  id: string;
  title: string;
  /** Bundled image URL for the print artwork (resolved from the file in ./prints/). */
  photo: string;
  /** Message printed on the BACK face of the print (revealed on flip). */
  message: string;
  /**
   * Print orientation override. Normally UNSET — the renderer auto-detects from the
   * image (wider-than-tall = 'landscape', else 'portrait'). Present only when an entry
   * in prints.ts forces a specific orientation.
   */
  orientation?: 'portrait' | 'landscape';
};

/** The three physical coin handles, left→right. Fixed machine hardware. */
export const slotOrder: SlotId[] = ['left', 'middle', 'right'];

/**
 * Which handle dispenses the print at a given catalogue index. Prints CYCLE across
 * the three handles by column (index % 3), so the catalogue can grow to ANY length
 * without per-print slot bookkeeping: print i lives in column i%3, row floor(i/3) of
 * the face grid, and is vended by that column's handle. Single source of truth for the
 * print→handle mapping (consumed by App's drawer queues).
 */
export function slotIdForIndex(index: number): SlotId {
  return slotOrder[index % slotOrder.length];
}

/**
 * Every image in ./prints/, keyed by its bundled URL. Vite turns this glob into per-file
 * asset imports at build time (?url = the resolved public path), so dropping a new image
 * into the folder makes it available with NO code change — the only thing the user edits
 * is the list in prints.ts. SVG and raster files load the same way (both become URLs that
 * the texture hooks draw via an <img>), so there is no separate raw/base64 path anymore.
 */
const printUrls = import.meta.glob('./prints/*.{jpg,jpeg,png,webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** basename (lowercased) -> bundled URL, so prints.ts can refer to images by plain filename. */
const urlByFileName = new Map<string, string>(
  Object.entries(printUrls).map(([path, url]) => [fileNameOf(path).toLowerCase(), url]),
);

/** The last path segment: './prints/Morning-Cake.svg' -> 'Morning-Cake.svg'. */
function fileNameOf(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1];
}

/** Strip the extension to form the stable id: 'birthday-sarah.jpg' -> 'birthday-sarah'. */
function idFromFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

/** Resolve one prints.ts entry into a renderable print, failing loud on a missing image. */
function resolvePrint(entry: PrintEntry): CelebrationPrint {
  const photo = urlByFileName.get(entry.file.toLowerCase());
  if (!photo) {
    const available = [...urlByFileName.keys()].sort().join(', ') || '(none)';
    throw new Error(
      `Print image not found: "${entry.file}". Drop it into src/data/prints/ ` +
        `(jpg, jpeg, png, webp, or svg). Available images: ${available}.`,
    );
  }
  return {
    id: idFromFileName(entry.file),
    title: entry.title ?? '',
    photo,
    message: entry.message ?? '',
    ...(entry.orientation ? { orientation: entry.orientation } : {}),
  };
}

/** Build the catalogue from prints.ts, guarding against two files sharing one id (stem). */
function buildCatalogue(entries: PrintEntry[]): CelebrationPrint[] {
  const resolved = entries.map(resolvePrint);
  const seen = new Set<string>();
  for (const print of resolved) {
    if (seen.has(print.id)) {
      throw new Error(
        `Duplicate print id "${print.id}" — two files in src/data/prints/ share a name ` +
          `(ignoring extension). Rename one so each print has a unique id.`,
      );
    }
    seen.add(print.id);
  }
  return resolved;
}

export const celebrationPrints: CelebrationPrint[] = buildCatalogue(prints);
