import { MAX_CARDS, newCardId, type Deck, type DeckCard } from './types';

/**
 * The `.quarters` file: one deck, one file, no server anywhere in the story.
 *
 * Everything here runs in the sender's browser and the recipient's browser. The
 * file is the only thing that moves, by whatever channel they already trust, so
 * there is nothing to host, nothing to expire, and no third party that ever sees
 * a photo. That is the whole design constraint; the rest is bookkeeping.
 *
 * Layout:
 *
 *   0   "QUARTERS"   magic, so a wrong file fails with a sentence instead of a
 *                    JSON parse error forty lines deep
 *   8   u8           format version
 *   9   u8           flags: bit0 encrypted, bit1 gzipped
 *   10  bytes        payload; when encrypted, salt(16) ‖ iv(12) ‖ ciphertext
 *
 * The payload is a JSON manifest with each image base64'd inline. Base64 costs a
 * third, and gzip gives most of it back (it recovers the 6-bits-in-8 padding, not
 * the image data, which is already compressed) — so the file lands within a few
 * percent of the raw bytes. A side-by-side binary blob section would beat it by
 * that few percent and cost a length table, offset arithmetic and a second set of
 * bounds checks. At a ~100 KB target that is not a trade worth making.
 */

/**
 * TypeScript 5.7 made Uint8Array generic over its backing buffer, and the DOM
 * signatures here (crypto.subtle, Blob, stream readers) all want the non-shared
 * `ArrayBuffer` instantiation specifically. Naming it once keeps that off every
 * signature below.
 */
type Bytes = Uint8Array<ArrayBuffer>;

const MAGIC = 'QUARTERS';
/** The project was called Halfmoon; decks sent under that name still open. */
const LEGACY_MAGIC = 'HALFMOON';
const VERSION = 1;
const FLAG_ENCRYPTED = 1 << 0;
const FLAG_GZIPPED = 1 << 1;

/** OWASP's floor for PBKDF2-HMAC-SHA256 at the time of writing. */
const PBKDF2_ITERATIONS = 210_000;

/** A deck that would not fit in memory is a corrupt or hostile file, not a deck. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export class DeckFileError extends Error {}

type ManifestCard = {
  id: string;
  title: string;
  message: string;
  orientation?: 'portrait' | 'landscape';
  mime: string;
  data: string;
};

type Manifest = {
  name: string;
  cards: ManifestCard[];
};

// ---- primitives -------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Chunked because `String.fromCharCode(...bytes)` on a 100 KB array spreads 100k
 * arguments onto the call stack and throws. 0x8000 is comfortably under every
 * engine's argument limit.
 */
function toBase64(bytes: Bytes): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

function fromBase64(value: string): Bytes {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Bytes> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Absent in older Safari, so compression is announced in the flags, never assumed. */
const canGzip = typeof CompressionStream !== 'undefined';

async function gzip(bytes: Bytes): Promise<Bytes> {
  return collect(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')));
}

async function gunzip(bytes: Bytes): Promise<Bytes> {
  if (typeof DecompressionStream === 'undefined') {
    throw new DeckFileError('This browser cannot read compressed deck files.');
  }
  return collect(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
}

async function deriveKey(passphrase: string, salt: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---- encode -----------------------------------------------------------------

/**
 * A passphrase is worth offering because the file travels through someone else's
 * chat server. It is only worth anything if it goes by a different route than the
 * file does — say the file over mail and the word in person. Sending both down
 * the same pipe protects against nothing.
 */
export async function encodeDeck(deck: Deck, passphrase?: string): Promise<Blob> {
  const cards: ManifestCard[] = [];
  for (const card of deck.cards) {
    const bytes = new Uint8Array(await card.image.arrayBuffer());
    cards.push({
      id: card.id,
      title: card.title,
      message: card.message,
      ...(card.orientation ? { orientation: card.orientation } : {}),
      mime: card.image.type || 'image/webp',
      data: toBase64(bytes),
    });
  }

  const manifest: Manifest = { name: deck.name, cards };
  let payload: Bytes = textEncoder.encode(JSON.stringify(manifest));
  let flags = 0;

  if (canGzip) {
    payload = await gzip(payload);
    flags |= FLAG_GZIPPED;
  }

  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload),
    );
    const joined = new Uint8Array(salt.length + iv.length + ciphertext.length);
    joined.set(salt, 0);
    joined.set(iv, salt.length);
    joined.set(ciphertext, salt.length + iv.length);
    payload = joined;
    flags |= FLAG_ENCRYPTED;
  }

  const header = new Uint8Array(10);
  header.set(textEncoder.encode(MAGIC), 0);
  header[8] = VERSION;
  header[9] = flags;

  return new Blob([header, payload], { type: 'application/octet-stream' });
}

// ---- the text wrapper -------------------------------------------------------

/**
 * What actually gets sent: the binary file above, base64'd between two armor
 * lines, under a few lines of plain English, saved as `.quarters.txt`.
 *
 * Only because of browsers. Chromium's Web Share refuses any file whose
 * extension and MIME type are not on a short allowlist (images, audio, video,
 * PDF, plain text…), so a `.quarters` file cannot go through the share sheet
 * on Android or desktop Chrome at all. Text is on the list and, unlike images,
 * chat apps pass it through untouched rather than recompressing it. The price
 * is base64's third, since the payload is already gzipped.
 *
 * The header is for a person who opens the file by accident: it says what the
 * file is and where to take it. The decoder ignores everything outside the
 * armor, so a chat app or an editor adding a line or turning \n into \r\n
 * does no harm. Wrapping the whole binary, not the manifest, keeps the
 * passphrase lock and the version byte exactly as they were.
 */
const ARMOR_BEGIN = '-----BEGIN FOUR QUARTERS DECK-----';
const ARMOR_END = '-----END FOUR QUARTERS DECK-----';

export async function encodeDeckText(
  deck: Deck,
  passphrase?: string,
  openAt?: string,
): Promise<Blob> {
  const binary = new Uint8Array(await (await encodeDeck(deck, passphrase)).arrayBuffer());
  const name = deck.name.trim();
  const lines = [
    name ? `Four Quarters deck: ${name}` : 'Four Quarters deck',
    openAt
      ? `To open it, go to ${openAt} and drop this file onto the page.`
      : 'To open it, drop this file onto the Four Quarters page.',
    'Everything below is the deck itself. Changing it will break it.',
    '',
    ARMOR_BEGIN,
    // 76 columns, as MIME does, so no viewer shows it as one enormous line.
    toBase64(binary).replace(/.{76}/g, '$&\n'),
    ARMOR_END,
    '',
  ];
  return new Blob([lines.join('\n')], { type: 'text/plain' });
}

/** The binary deck inside either form: passed through when it is already binary. */
async function unwrap(file: Blob): Promise<Blob> {
  const magic = textDecoder.decode(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
  if (magic === MAGIC || magic === LEGACY_MAGIC) return file;
  // Base64 is 4/3 of the bytes; anything much past that is not one of ours.
  if (file.size > MAX_FILE_BYTES * 1.5) throw new DeckFileError('That deck file is implausibly large.');

  const text = await file.text();
  const start = text.indexOf(ARMOR_BEGIN);
  const end = start < 0 ? -1 : text.indexOf(ARMOR_END, start);
  if (start < 0 || end < 0) throw new DeckFileError('That is not a Four Quarters deck file.');
  try {
    return new Blob([fromBase64(text.slice(start + ARMOR_BEGIN.length, end).replace(/\s+/g, ''))]);
  } catch {
    throw new DeckFileError('That deck file is damaged.');
  }
}

// ---- decode -----------------------------------------------------------------

/** True when the file needs a passphrase — so the UI can ask before it tries and fails. */
export async function deckFileIsEncrypted(input: Blob): Promise<boolean> {
  const file = await unwrap(input);
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  readHeader(head);
  return (head[9] & FLAG_ENCRYPTED) !== 0;
}

function readHeader(head: Bytes): { version: number; flags: number } {
  const magic = head.length < 10 ? '' : textDecoder.decode(head.subarray(0, 8));
  if (magic !== MAGIC && magic !== LEGACY_MAGIC) {
    throw new DeckFileError('That is not a Four Quarters deck file.');
  }
  const version = head[8];
  if (version !== VERSION) {
    throw new DeckFileError(
      `That deck was made by a newer version of Four Quarters (format ${version}).`,
    );
  }
  return { version, flags: head[9] };
}

export async function decodeDeck(input: Blob, passphrase?: string): Promise<Deck> {
  const file = await unwrap(input);
  if (file.size > MAX_FILE_BYTES) throw new DeckFileError('That deck file is implausibly large.');

  const all = new Uint8Array(await file.arrayBuffer());
  const { flags } = readHeader(all.subarray(0, 10));
  let payload = all.subarray(10);

  if (flags & FLAG_ENCRYPTED) {
    if (!passphrase) throw new DeckFileError('That deck is locked. It needs its passphrase.');
    if (payload.length < 28) throw new DeckFileError('That deck file is truncated.');
    const salt = payload.subarray(0, 16);
    const iv = payload.subarray(16, 28);
    const key = await deriveKey(passphrase, salt);
    try {
      payload = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload.subarray(28)),
      );
    } catch {
      // AES-GCM fails authentication identically for a wrong passphrase and a
      // tampered file, and there is no way to tell them apart. Say the likely one.
      throw new DeckFileError('That passphrase did not open the deck.');
    }
  }

  if (flags & FLAG_GZIPPED) payload = await gunzip(payload);

  let manifest: Manifest;
  try {
    manifest = JSON.parse(textDecoder.decode(payload)) as Manifest;
  } catch {
    throw new DeckFileError('That deck file is damaged.');
  }

  return { name: nameOf(manifest), cards: cardsOf(manifest) };
}

function nameOf(manifest: Manifest): string {
  return typeof manifest?.name === 'string' ? manifest.name.slice(0, 120) : 'Shared deck';
}

/**
 * Everything past the header is attacker-controlled in the sense that matters
 * here: it arrived as a file from somewhere. Nothing is trusted to be the type it
 * claims, ids are regenerated when they collide (a duplicate id silently breaks
 * the collected-set and thumbnail lookups), and the image mime is pinned to a
 * short allowlist so a manifest cannot talk the browser into treating a blob as
 * something scriptable.
 */
const ALLOWED_MIME = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif']);

function cardsOf(manifest: Manifest): DeckCard[] {
  const raw = Array.isArray(manifest?.cards) ? manifest.cards : [];
  if (raw.length === 0) throw new DeckFileError('That deck has no cards in it.');

  const seen = new Set<string>();
  const cards: DeckCard[] = [];

  for (const entry of raw.slice(0, MAX_CARDS)) {
    if (typeof entry?.data !== 'string') continue;
    const mime = ALLOWED_MIME.has(entry.mime) ? entry.mime : 'image/webp';

    let bytes: Bytes;
    try {
      bytes = fromBase64(entry.data);
    } catch {
      continue; // one unreadable card should not cost the whole deck
    }
    if (bytes.length === 0) continue;

    let id = typeof entry.id === 'string' && entry.id ? entry.id.slice(0, 64) : newCardId();
    while (seen.has(id)) id = newCardId();
    seen.add(id);

    cards.push({
      id,
      title: typeof entry.title === 'string' ? entry.title.slice(0, 80) : '',
      message: typeof entry.message === 'string' ? entry.message.slice(0, 2000) : '',
      ...(entry.orientation === 'portrait' || entry.orientation === 'landscape'
        ? { orientation: entry.orientation }
        : {}),
      image: new Blob([bytes], { type: mime }),
    });
  }

  if (cards.length === 0) throw new DeckFileError('None of the cards in that deck could be read.');
  return cards;
}

/**
 * A deck file by name: `.quarters.txt` as sent now, bare `.quarters` from before
 * the text wrapper, `.halfmoon` from before the rename. Tolerates the ` (1)` a
 * download folder adds to a second copy. Only ever a hint — the contents decide.
 */
export function isDeckFileName(name: string): boolean {
  return /\.(quarters|halfmoon)( ?\(\d+\))?(\.txt)?$/i.test(name);
}

/** `Sam's birthday` -> `sams-birthday.quarters.txt`, with a fallback for a nameless deck. */
export function deckFileName(name: string): string {
  const slug = name
    .toLowerCase()
    // Apostrophes vanish rather than becoming separators: `sam-s-birthday` reads
    // like a typo, `sams-birthday` reads like a filename someone chose.
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'four-quarters-deck'}.quarters.txt`;
}
