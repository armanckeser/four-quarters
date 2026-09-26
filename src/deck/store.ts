import type { Deck } from './types';

/**
 * Where a deck lives between visits.
 *
 * IndexedDB rather than localStorage because a deck is megabytes of Blob and
 * localStorage is a synchronous string store with a ~5 MB cap — base64'ing
 * photographs into it would block the main thread and then run out of room. It
 * also stores Blobs natively, so the artwork never round-trips through base64
 * just to sit on disk.
 *
 * One record. A deck is the thing you are working on, not a library of things,
 * and a single slot keeps "which deck am I editing" from becoming a concept the
 * user has to hold.
 */

// The project's former name. Renaming the database would orphan every saved draft.
const DB_NAME = 'halfmoon';
const DB_VERSION = 1;
const STORE = 'decks';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = body(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/**
 * Every call is best-effort. Private windows, a full disk and Safari's storage
 * eviction all make IndexedDB throw or come back empty, and none of those should
 * stop the machine from running on the bundled catalogue — losing a saved draft
 * is a disappointment, a blank screen is a bug.
 */
export async function loadDeck(): Promise<Deck | null> {
  try {
    const stored = await run<Deck | undefined>('readonly', (store) => store.get(KEY));
    if (!stored || !Array.isArray(stored.cards) || stored.cards.length === 0) return null;
    // A Blob that survived a reload can still be dead if the browser evicted its
    // backing file; reading one byte is the cheapest way to find out here rather
    // than at render time, as a texture that never loads.
    await stored.cards[0].image.slice(0, 1).arrayBuffer();
    return stored;
  } catch {
    return null;
  }
}

export async function saveDeck(deck: Deck): Promise<void> {
  try {
    await run('readwrite', (store) => store.put(deck, KEY));
  } catch {
    // ignored: see the note above
  }
}

export async function clearDeck(): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(KEY));
  } catch {
    // ignored: see the note above
  }
}
