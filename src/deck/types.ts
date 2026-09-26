import type { CelebrationPrint } from '../data/celebration';

/**
 * A card the user made, as it lives in memory and in IndexedDB.
 *
 * The artwork is a Blob rather than a URL because a URL is the one form that does
 * NOT survive: `URL.createObjectURL` handles die with the document, so a deck
 * persisted as URLs comes back after a reload pointing at nothing. Blobs go into
 * IndexedDB as-is, and object URLs are minted from them at render time
 * (`useDeckPrints`), which is also the only place that has to revoke them.
 */
export type DeckCard = {
  /** Stable, unique within the deck. Also the collected-set key, so it must not change. */
  id: string;
  /** Shown along the bottom of the print. May be empty. */
  title: string;
  /** Written on the BACK of the card, revealed on flip. May be empty. */
  message: string;
  /** Set only to override the renderer's wider-than-tall auto-detection. */
  orientation?: 'portrait' | 'landscape';
  /** Already downscaled and re-encoded by `prepareImage` — never an original camera file. */
  image: Blob;
};

export type Deck = {
  /** Free text, shown on the export and used to name the downloaded file. */
  name: string;
  cards: DeckCard[];
};

/** What the machine actually renders: the bundled catalogue and a made deck share a shape. */
export type RenderablePrints = CelebrationPrint[];

export const MAX_CARDS = 24;

/**
 * Generated per card rather than derived from the filename, because two photos picked
 * out of a camera roll are very often both called IMG_4312.
 */
export function newCardId(): string {
  return 'c' + Math.random().toString(36).slice(2, 10);
}
