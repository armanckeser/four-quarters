import { DeckFileError, encodeDeck } from './codec';
import type { Deck } from './types';

/**
 * Sending a deck as a link: seal it here, park the sealed bytes with the deck
 * locker (worker/), and put the key in the link's #fragment.
 *
 * The key never leaves the two browsers. It is generated per deck, travels only
 * inside the link, and the fragment is not sent in any HTTP request — so the
 * locker holds bytes it cannot open, and a leaked locker is a pile of noise.
 *
 * The sealed payload is the ordinary binary `.quarters` file (so a passphrase
 * lock still works on top, and the recipient's code path after unsealing is the
 * same one a dropped file takes), AES-GCM'd with a raw 256-bit key: no PBKDF2
 * here, because the key is random rather than something a person typed.
 *
 *   sealed = iv(12) ‖ AES-GCM(key, iv, quarters-file)
 */

/** Set at build time (see worker/README.md). Unset means the link option is hidden. */
const LOCKER = (import.meta.env.VITE_QUARTERS_CLOUD ?? '').replace(/\/+$/, '');

export const cloudAvailable = LOCKER !== '';

/** How long the locker keeps a deck; worker/src/index.ts enforces the same number. */
export const CLOUD_DAYS = 30;

type Bytes = Uint8Array<ArrayBuffer>;

function toBase64Url(bytes: Bytes): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): Bytes {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export type CloudHandle = { id: string; key: string };

export async function uploadDeck(deck: Deck, passphrase?: string): Promise<CloudHandle> {
  if (!cloudAvailable) throw new Error('No deck locker configured.');
  const plain = new Uint8Array(await (await encodeDeck(deck, passphrase)).arrayBuffer());
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const sealed = new Uint8Array(iv.length + cipher.length);
  sealed.set(iv, 0);
  sealed.set(cipher, iv.length);

  const response = await fetch(`${LOCKER}/d`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: sealed,
  });
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? 'Too many links in a row. Wait a minute and try again.'
        : 'The deck could not be uploaded. Check your connection, or send the file instead.',
    );
  }
  const { id } = (await response.json()) as { id: string };
  return { id, key: toBase64Url(rawKey) };
}

/** The binary `.quarters` file inside a sealed deck, ready for `openFile`. */
export async function downloadDeck({ id, key }: CloudHandle): Promise<Blob> {
  if (!cloudAvailable) throw new DeckFileError('This copy of the machine cannot open deck links.');
  let response: Response;
  try {
    response = await fetch(`${LOCKER}/d/${encodeURIComponent(id)}`);
  } catch {
    throw new DeckFileError('Could not reach the deck. Check your connection and try again.');
  }
  if (response.status === 404) {
    throw new DeckFileError(
      `This deck has expired — links last ${CLOUD_DAYS} days. Ask them to send it again.`,
    );
  }
  if (!response.ok) throw new DeckFileError('Could not fetch the deck. Try again in a moment.');

  const sealed = new Uint8Array(await response.arrayBuffer());
  if (sealed.length < 13) throw new DeckFileError('That deck is damaged.');
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', fromBase64Url(key), 'AES-GCM', false, [
      'decrypt',
    ]);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(0, 12) },
      cryptoKey,
      sealed.subarray(12),
    );
    return new Blob([plain]);
  } catch {
    // A wrong key and a tampered blob fail identically; the likely cause is a
    // link that lost characters on its way through a chat app.
    throw new DeckFileError('This link looks incomplete. Ask them to send it again.');
  }
}
