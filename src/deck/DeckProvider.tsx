import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { celebrationPrints, type CelebrationPrint } from '../data/celebration';
import { decodeDeck, deckFileIsEncrypted, DeckFileError } from './codec';
import { clearDeck as clearStoredDeck, loadDeck, saveDeck } from './store';
import type { Deck } from './types';

/**
 * Which prints the machine is currently loaded with.
 *
 * The bundled catalogue is the floor, not a special case: with no deck made or
 * opened, the machine vends what shipped with it, exactly as before this existed.
 * A deck replaces that wholesale. There is no merging — a deck someone sent you
 * is a thing they made, and quietly mixing your prints into it would be wrong.
 */

type DeckContextValue = {
  /** null means the bundled catalogue is loaded. */
  deck: Deck | null;
  /** What the scene renders. Object URLs, minted and revoked with the deck. */
  prints: CelebrationPrint[];
  /** Still reading IndexedDB; the machine renders the bundled deck meanwhile. */
  loading: boolean;
  /**
   * Takes an updater as well as a value, for the same reason setState does:
   * shrinking a photo is asynchronous, so a caller that captured the deck before
   * its awaits would write back a version that predates anything added while it
   * was working. Dropping a second batch of pictures while the first is still
   * being resized is an easy thing to do and an invisible thing to lose.
   */
  useDeck: (deck: Deck | ((current: Deck | null) => Deck)) => void;
  useBundled: () => void;
  /** Reads a dropped/picked `.quarters`. Throws DeckFileError with a sentence for the UI. */
  openFile: (file: Blob, passphrase?: string) => Promise<void>;
  fileNeedsPassphrase: (file: Blob) => Promise<boolean>;
};

const DeckContext = createContext<DeckContextValue | null>(null);

/**
 * Object URLs for the artwork, cached by Blob identity.
 *
 * Keyed on the image and not on the deck, because the deck object changes on
 * every keystroke in the builder — a URL minted per deck would revoke and
 * replace all of them each time a title was typed, which flashes every texture
 * in the scene and makes the machine reset under the user's hands. Blobs are
 * immutable here (editing text never touches one), so identity is exactly the
 * right key: a URL is created when a picture first appears and revoked when that
 * picture leaves the deck.
 */
function usePrintsFor(deck: Deck | null): CelebrationPrint[] {
  const urls = useRef(new Map<Blob, string>());

  useEffect(() => {
    const cache = urls.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  return useMemo(() => {
    if (!deck) return celebrationPrints;
    const cache = urls.current;
    const live = new Set<Blob>();

    const prints = deck.cards.map((card) => {
      live.add(card.image);
      let url = cache.get(card.image);
      if (!url) {
        url = URL.createObjectURL(card.image);
        cache.set(card.image, url);
      }
      return {
        id: card.id,
        title: card.title,
        photo: url,
        message: card.message,
        ...(card.orientation ? { orientation: card.orientation } : {}),
      };
    });

    for (const [image, url] of cache) {
      if (!live.has(image)) {
        URL.revokeObjectURL(url);
        cache.delete(image);
      }
    }
    return prints;
  }, [deck]);
}

export function DeckProvider({ children }: { children: ReactNode }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);
  const prints = usePrintsFor(deck);

  // The updater is resolved against this rather than inside setDeck, because
  // StrictMode double-invokes state updaters and the write to IndexedDB must
  // happen once. It is assigned before setDeck so two adopt() calls in the same
  // tick compose instead of the second overwriting the first.
  const latest = useRef<Deck | null>(null);

  // Restore whatever was being worked on, once. A failure here is not worth
  // surfacing: the machine simply comes up with the bundled prints.
  useEffect(() => {
    let live = true;
    loadDeck()
      .then((stored) => {
        if (live && stored) {
          latest.current = stored;
          setDeck(stored);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const adopt = useCallback((next: Deck | ((current: Deck | null) => Deck)) => {
    const resolved = typeof next === 'function' ? next(latest.current) : next;
    latest.current = resolved;
    setDeck(resolved);
    void saveDeck(resolved);
  }, []);

  const useBundled = useCallback(() => {
    latest.current = null;
    setDeck(null);
    void clearStoredDeck();
  }, []);

  const openFile = useCallback(
    async (file: Blob, passphrase?: string) => {
      adopt(await decodeDeck(file, passphrase));
    },
    [adopt],
  );

  const fileNeedsPassphrase = useCallback(async (file: Blob) => {
    try {
      return await deckFileIsEncrypted(file);
    } catch (error) {
      if (error instanceof DeckFileError) throw error;
      throw new DeckFileError('That file could not be read.');
    }
  }, []);

  const value = useMemo<DeckContextValue>(
    () => ({ deck, prints, loading, useDeck: adopt, useBundled, openFile, fileNeedsPassphrase }),
    [deck, prints, loading, adopt, useBundled, openFile, fileNeedsPassphrase],
  );

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDeckContext(): DeckContextValue {
  const value = useContext(DeckContext);
  if (!value) throw new Error('useDeckContext must be used inside <DeckProvider>.');
  return value;
}

/**
 * The scene's view of the world: just the prints. Used by MachineScene and its
 * children so no part of the 3D tree has to know a deck is a concept.
 */
export function usePrints(): CelebrationPrint[] {
  return useDeckContext().prints;
}
