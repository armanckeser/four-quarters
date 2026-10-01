import { useEffect, useRef, useState } from 'react';
import { useDeckContext } from './DeckProvider';
import { DeckFileError, isDeckFileName } from './codec';
import type { Invite } from './invite';

/**
 * What someone sees when they open a link a friend sent them (see invite.ts).
 *
 * They arrive knowing nothing — not what this page is, not what the attachment
 * is for — so this reads top to bottom as the answer: who it's from (the note),
 * what to do (drop the file), and where that file probably is. The drop zone
 * names the exact file, because "a deck file" means nothing to them but
 * "Sam's Birthday Deck" is something they can find in a chat.
 *
 * The machine is already running behind this; the panel is small so the thing
 * they are about to load is visible while they load it.
 */
export function Receive({ invite, onClose }: { invite: Invite; onClose: () => void }) {
  const { deck, openFile, fileNeedsPassphrase } = useDeckContext();
  const [passphrase, setPassphrase] = useState('');
  const [askPassphrase, setAskPassphrase] = useState(invite.locked);
  const [pending, setPending] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  async function open(file: File, phrase = passphrase) {
    setError(null);
    setWorking(true);
    try {
      if ((await fileNeedsPassphrase(file)) && !phrase) {
        // Hold on to the file so typing the passphrase is the only thing left
        // to do; making them find and drop it a second time would be cruel.
        setPending(file);
        setAskPassphrase(true);
        setError('This deck is locked. Type the passphrase they gave you.');
        requestAnimationFrame(() => passRef.current?.focus());
        return;
      }
      await openFile(file, phrase || undefined);
      setPending(null);
      setLoaded(invite.cards || -1);
    } catch (failure) {
      if (failure instanceof DeckFileError && /passphrase/i.test(failure.message)) setPending(file);
      // The contents decide, not the name — chat apps rename attachments — but
      // a wrong file with the wrong name is most likely the wrong attachment.
      setError(
        !isDeckFileName(file.name)
          ? `${file.name} isn’t the deck. Look for the one ending in “Deck”.`
          : failure instanceof DeckFileError
            ? failure.message
            : 'That file could not be opened.',
      );
    } finally {
      setWorking(false);
    }
  }

  // The whole window is the drop target, as in the builder: aiming at a box is
  // harder than it should be, and anything dropped here is meant for this.
  useEffect(() => {
    if (loaded !== null) return;
    const over = (event: DragEvent) => event.preventDefault();
    const drop = (event: DragEvent) => {
      event.preventDefault();
      const dropped = event.dataTransfer?.files?.[0];
      if (dropped) void open(dropped);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  });

  const fileLabel = invite.file ? `“${invite.file}”` : 'the deck file';
  const count = invite.cards ? `${invite.cards} ${invite.cards === 1 ? 'print' : 'prints'}` : 'prints';

  if (loaded !== null) {
    return (
      <div className="receive" role="dialog" aria-labelledby="receive-heading">
        <p className="receive-eyebrow">Loaded</p>
        <h2 id="receive-heading">{invite.name || 'Your deck'} is in the machine</h2>
        <p className="receive-body">
          Click a handle to drop in four quarters, click it again to push it in and pull it out,
          then take the card that slides out.
        </p>
        <button className="receive-primary" onClick={onClose}>
          Start
        </button>
      </div>
    );
  }

  return (
    <div className="receive" role="dialog" aria-labelledby="receive-heading">
      <p className="receive-eyebrow">Someone sent you a deck</p>
      <h2 id="receive-heading">{invite.name || 'A deck of prints'}</h2>

      {invite.note ? <blockquote className="receive-note">{invite.note}</blockquote> : null}

      <p className="receive-body">
        This is a little coin machine that vends {count}. The pictures come in a file they sent
        along with this link — open it here to load the machine.
      </p>

      {askPassphrase ? (
        <label className="receive-pass">
          <span>Passphrase</span>
          <input
            ref={passRef}
            type="password"
            value={passphrase}
            autoComplete="off"
            placeholder="They’ll have told you separately"
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && pending && passphrase) void open(pending);
            }}
          />
        </label>
      ) : null}

      {pending ? (
        <button
          className="receive-primary"
          disabled={working || !passphrase}
          onClick={() => void open(pending)}
        >
          {working ? 'Opening…' : `Unlock ${pending.name}`}
        </button>
      ) : (
        <button className="receive-drop" onClick={() => pickRef.current?.click()} disabled={working}>
          <strong>{working ? 'Opening…' : `Drop ${fileLabel} here`}</strong>
          <span>or tap to choose it</span>
        </button>
      )}

      {error ? <p className="receive-error">{error}</p> : null}

      <details className="receive-help">
        <summary>Can’t find the file?</summary>
        <ul>
          <li>It came as an attachment in the same chat or email as this link.</li>
          <li>On a computer, it is usually in your Downloads folder once you open it.</li>
          <li>
            On an iPhone, tap the attachment and use “Save to Files”, then choose it here. On
            Android, download it, then choose it from Downloads.
          </li>
          <li>Nothing is uploaded — the file is opened right here in your browser.</li>
        </ul>
      </details>

      {deck ? (
        // Only shown before loading; afterwards `deck` is the one just opened.
        <p className="receive-small">This replaces the deck you were making on this device.</p>
      ) : null}

      <button className="receive-quiet" onClick={onClose}>
        Not now — just look around
      </button>

      <input
        ref={pickRef}
        type="file"
        // No `accept`: a chat app may have renamed the file, and iOS greys out
        // anything that does not match. The contents are checked instead.
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) void open(picked);
          event.target.value = '';
        }}
      />
    </div>
  );
}
