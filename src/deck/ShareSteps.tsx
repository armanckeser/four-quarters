import { useEffect, useState } from 'react';
import { inviteUrl, NOTE_MAX } from './invite';
import type { Deck } from './types';

/**
 * Steps two and three of the builder: getting a finished deck to someone.
 *
 * This used to be one "Save deck file" button at the bottom of the card list,
 * after which the user was holding a file with an unfamiliar extension and no
 * idea what the other person was meant to do with it. Two things were missing,
 * and each step supplies one:
 *
 *   Save — what the file IS. It is the whole deck and the only copy that leaves
 *          this device, so say what is in it and roughly how big it is before
 *          asking anyone to download it.
 *   Send — what the recipient DOES. A file alone is not an instruction, so it
 *          travels with a link that opens the machine ready to receive it
 *          (see invite.ts), and a ready-written message saying so.
 *
 * Buttons say what they do next ("Next: send it") rather than a bare "Next";
 * a flow people go through once or twice has to explain itself as it goes.
 */

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// ---- save --------------------------------------------------------------------

export function SaveStep({
  deck,
  fileName,
  size,
  passphrase,
  onPassphrase,
  downloaded,
  working,
  onSave,
  onBack,
  onNext,
}: {
  deck: Deck;
  fileName: string;
  /** Approximate until the file has been written, exact after. */
  size: number;
  passphrase: string;
  onPassphrase: (value: string) => void;
  downloaded: boolean;
  working: boolean;
  onSave: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const withMessages = deck.cards.filter((card) => card.message.trim()).length;
  const withTitles = deck.cards.filter((card) => card.title.trim()).length;

  return (
    <section className="builder-step" aria-labelledby="save-heading">
      <h2 id="save-heading">Save your deck as a file</h2>
      <p className="builder-lede">
        Your deck lives only in this browser. To give it to someone, save it as one small file
        and send them that.
      </p>

      <div className="builder-file">
        <div className="builder-file-icon" aria-hidden="true">
          ¼
        </div>
        <div className="builder-file-meta">
          <strong>{fileName}</strong>
          <span>about {humanSize(size)}</span>
        </div>
      </div>

      <div className="builder-explain">
        <h3>What’s inside</h3>
        <ul>
          <li>{plural(deck.cards.length, 'picture', 'pictures')}, shrunk to fit a card</li>
          {withTitles > 0 ? <li>{plural(withTitles, 'title', 'titles')}</li> : null}
          <li>
            {withMessages > 0
              ? `${plural(withMessages, 'message', 'messages')} for the backs of the cards`
              : 'No messages yet — the backs will be blank'}
          </li>
          {deck.name.trim() ? <li>The deck’s name, “{deck.name.trim()}”</li> : null}
        </ul>
        <p>Nothing is uploaded anywhere. The file is the only copy that leaves this device.</p>
      </div>

      <details className="builder-lock" open={passphrase ? true : undefined}>
        <summary>Lock it with a passphrase (optional)</summary>
        <label>
          <span className="sr-only">Passphrase</span>
          <input
            type="password"
            value={passphrase}
            placeholder="Passphrase"
            autoComplete="new-password"
            onChange={(event) => onPassphrase(event.target.value)}
          />
        </label>
        <p>
          Only someone with the passphrase can open the file. Tell them in person or send it
          apart from the file — sending both in the same chat protects nothing.
        </p>
      </details>

      <div className="builder-step-foot">
        {downloaded ? (
          <>
            <p className="builder-done" role="status">
              ✓ Saved. Look for <strong>{fileName}</strong> in your Downloads.
            </p>
            <button className="builder-primary" onClick={onNext}>
              Next: send it →
            </button>
            <button className="builder-link" onClick={onSave} disabled={working}>
              Download again
            </button>
          </>
        ) : (
          <button className="builder-primary" onClick={onSave} disabled={working}>
            {working ? 'Writing the file…' : 'Download the file'}
          </button>
        )}
        <button className="builder-link" onClick={onBack}>
          ← Back to the cards
        </button>
      </div>
    </section>
  );
}

// ---- send --------------------------------------------------------------------

/**
 * The ready-to-paste message. Written for the recipient, who knows nothing: what
 * the link is, what the attachment is, and what order to do them in.
 */
function messageFor(note: string, url: string, fileName: string, locked: boolean): string {
  const lines = [];
  if (note.trim()) lines.push(note.trim(), '');
  lines.push(
    `I made you a deck of prints for a little coin machine. Open this link, then drop in the file I'm sending with it (${fileName}):`,
    url,
  );
  if (locked) lines.push('', "It's locked — I'll tell you the passphrase separately.");
  return lines.join('\n');
}

/** `navigator.share` with a file: iOS/iPadOS Safari and some Android browsers. */
function canShareFile(file: File | null): boolean {
  if (!file || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The async clipboard is missing on plain-http LAN addresses (the dev server
    // on a phone) and refused in some embedded webviews. The old command still
    // works there, but only on a selection, so make one for the moment.
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(scratch);
    scratch.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      scratch.remove();
    }
  }
}

export function SendStep({
  deck,
  file,
  fileName,
  locked,
  downloaded,
  note,
  onNote,
  onSave,
  onBack,
  onDone,
}: {
  deck: Deck;
  /** The written file, for the share sheet. null while it is being written. */
  file: File | null;
  fileName: string;
  locked: boolean;
  downloaded: boolean;
  note: string;
  onNote: (value: string) => void;
  onSave: () => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<'message' | 'link' | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  // The page's own address minus any fragment, so the link follows the app to
  // wherever it is hosted (a GitHub Pages sub-path, a LAN dev server).
  const url = inviteUrl(window.location.origin + window.location.pathname, {
    note,
    name: deck.name,
    file: fileName,
    cards: deck.cards.length,
    locked,
  });
  const message = messageFor(note, url, fileName, locked);
  const shareable = canShareFile(file);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (what: 'message' | 'link') => {
    const ok = await copyText(what === 'message' ? message : url);
    setCopied(ok ? what : null);
    setCopyFailed(!ok);
  };

  const share = async () => {
    if (!file) return;
    setShareError(null);
    try {
      // File and message in one go: the share sheet attaches the file to the
      // same chat message, which is exactly the pairing the recipient needs.
      await navigator.share({ files: [file], text: message, title: deck.name || 'Four Quarters' });
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setShareError('Sharing did not work here. Copy the message below instead.');
    }
  };

  return (
    <section className="builder-step" aria-labelledby="send-heading">
      <h2 id="send-heading">Send it</h2>
      <p className="builder-lede">
        They need two things: <strong>a link</strong> that opens this machine ready for their
        deck, and <strong>the file</strong> itself. The link holds your note, not your pictures.
      </p>

      {!downloaded ? (
        <p className="builder-warn">
          You haven’t downloaded the file yet.{' '}
          <button className="builder-link" onClick={onSave}>
            Download {fileName}
          </button>
        </p>
      ) : null}

      <ol className="builder-howto">
        <li>
          <label htmlFor="send-note">Write a short note</label>
          <textarea
            id="send-note"
            value={note}
            rows={2}
            maxLength={NOTE_MAX}
            placeholder="Happy birthday! Put in four quarters…"
            onChange={(event) => onNote(event.target.value)}
          />
          <span className="builder-count">
            {note.length}/{NOTE_MAX} · shown when they open the link
          </span>
        </li>

        <li>
          <span className="builder-howto-title">Copy the message</span>
          <textarea
            className="builder-preview"
            value={message}
            readOnly
            rows={6}
            aria-label="The message that will be copied"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="builder-row">
            <button className="builder-primary" onClick={() => copy('message')}>
              {copied === 'message' ? '✓ Copied' : 'Copy message'}
            </button>
            <button onClick={() => copy('link')}>
              {copied === 'link' ? '✓ Copied' : 'Copy link only'}
            </button>
          </div>
          {copyFailed ? (
            <p className="builder-error">
              This browser would not copy. Select the message above and copy it by hand.
            </p>
          ) : null}
        </li>

        <li>
          <span className="builder-howto-title">Paste it in a chat or email, and attach the file</span>
          <p>
            Attach <strong>{fileName}</strong> from your Downloads. They open the link, then drop
            the file onto the page.
          </p>
        </li>
      </ol>

      {shareable ? (
        <div className="builder-share">
          <p>On this device you can send the message and the file together:</p>
          <button className="builder-primary" onClick={share}>
            Share message + file…
          </button>
          {shareError ? <p className="builder-error">{shareError}</p> : null}
        </div>
      ) : null}

      {locked ? (
        <p className="builder-note">
          Locked: remember to give them the passphrase some other way.
        </p>
      ) : null}

      <div className="builder-step-foot">
        <button onClick={onDone}>Done</button>
        <button className="builder-link" onClick={onBack}>
          ← Back to saving
        </button>
      </div>
    </section>
  );
}
