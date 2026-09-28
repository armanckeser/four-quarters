import { isDeckFileName } from './codec';
import { MAX_CARDS } from './types';

/**
 * The link that travels next to a `.quarters` file.
 *
 * A deck file on its own is a mystery attachment: the person who receives it has
 * no idea what opens it, and "drop this on a website" is not an instruction
 * anyone follows from a filename. The link is the instruction. Opening it lands
 * on the machine with the sender's note and a place to drop the file, already
 * named, so the only thing left to work out is where their chat app saved it.
 *
 * It carries NO pictures and nothing that can open the deck — just the note, the
 * file's name, how many cards to expect and whether a passphrase is needed. It
 * lives in the fragment (`#open?…`) rather than the query string because the
 * fragment never leaves the browser: the static host serving the page does not
 * see the note in its logs, which keeps "no server ever sees your stuff" true.
 *
 * Everything read back is untrusted — anyone can type a URL — so it is clamped
 * and shape-checked the same way the codec treats a file, and the UI only ever
 * renders it as text.
 */

export type Invite = {
  /** The sender's short note, shown above the drop zone. May be empty. */
  note: string;
  /** The deck's name, for the heading. May be empty. */
  name: string;
  /** The file to look for, e.g. `sams-birthday.quarters`. Empty if the link had none/a bad one. */
  file: string;
  /** Cards in the deck, 0 when unknown. */
  cards: number;
  /** The file is locked; ask for the passphrase up front instead of after a failed open. */
  locked: boolean;
};

/** A note, not a letter: the letters go on the backs of the cards. Also keeps the URL pasteable. */
export const NOTE_MAX = 280;
const NAME_MAX = 80;
const PREFIX = '#open?';

export function inviteUrl(base: string, invite: Invite): string {
  const params = new URLSearchParams();
  if (invite.note.trim()) params.set('note', invite.note.trim().slice(0, NOTE_MAX));
  if (invite.name.trim()) params.set('name', invite.name.trim().slice(0, NAME_MAX));
  params.set('file', invite.file);
  if (invite.cards > 0) params.set('cards', String(invite.cards));
  if (invite.locked) params.set('locked', '1');
  // URLSearchParams writes spaces as `+`, which reads fine and survives every
  // chat app's link detector; `%20` does too but makes the note unreadable.
  return base.split('#')[0] + PREFIX + params.toString();
}

/** null when the hash is not an invite at all, so an ordinary visit is untouched. */
export function readInvite(hash: string): Invite | null {
  if (!hash.startsWith(PREFIX)) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(hash.slice(PREFIX.length));
  } catch {
    return null;
  }
  const file = (params.get('file') ?? '').trim();
  const cards = Number.parseInt(params.get('cards') ?? '', 10);
  return {
    note: clean(params.get('note'), NOTE_MAX),
    name: clean(params.get('name'), NAME_MAX),
    // A name that is not a deck file is dropped rather than shown: the heading
    // tells the reader to go looking for exactly this, so it must be plausible.
    file: isDeckFileName(file) && file.length <= 80 ? file : '',
    cards: Number.isFinite(cards) && cards > 0 && cards <= MAX_CARDS ? cards : 0,
    locked: params.get('locked') === '1',
  };
}

/** Strips control characters (keeping line breaks) and clamps. */
function clean(value: string | null, max: number): string {
  return (value ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
}

/** Drops an invite from the address bar once handled, so a reload does not ask again. */
export function clearInviteFromUrl(): void {
  if (!window.location.hash.startsWith(PREFIX)) return;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', pathname + search);
}
