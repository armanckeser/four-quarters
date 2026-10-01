import { useEffect, useRef, useState } from 'react';
import { inviteUrl, NOTE_MAX } from './invite';
import type { Deck } from './types';

/**
 * The builder's last step: name the deck, write a note, and get both it and the
 * file to someone.
 *
 * The order is the order a person thinks in — what is it called, what do I
 * want to say, send — and the file is a detail underneath that, not a step of
 * its own. It is written in the background while they type (Builder.tsx), so
 * by the time they reach for the button there is something to hand over.
 *
 * ONE path everywhere: download the file, copy (or, on a phone, share) the
 * message, attach the file in that same chat. There used to be a share-the-file
 * button on phones, but the share sheet routinely kept the attachment and dropped
 * the text, so the person got a file with no link and no idea what it was for —
 * the one thing the message exists to prevent. Three plain steps work in every
 * chat app on every device, and the file is named like something a person sent
 * ("Sam's Birthday Deck"), so finding it to attach is not a puzzle.
 */

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Text-only sharing: every browser with a share sheet can do this, Chrome on Android included. */
function canShareText(): boolean {
  return typeof navigator.share === 'function';
}

/**
 * The ready-to-send message. Written for the recipient, who knows nothing: what
 * the link is, what the attachment is, and what order to do them in.
 */
function messageFor(note: string, url: string, fileName: string, locked: boolean): string {
  const lines = [];
  if (note.trim()) lines.push(note.trim(), '');
  lines.push(
    `I made you a deck of prints for a little coin machine. Open this link, then drop in the file I'm sending with it, “${fileName}”:`,
    url,
  );
  if (locked) lines.push('', "It's locked — I'll tell you the passphrase separately.");
  return lines.join('\n');
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
  onName,
  file,
  fileName,
  size,
  passphrase,
  onPassphrase,
  downloaded,
  onDownload,
  note,
  onNote,
  onBack,
  onDone,
}: {
  deck: Deck;
  onName: (value: string) => void;
  /** The written file. null while it is being (re)written after an edit. */
  file: File | null;
  fileName: string;
  /** Approximate until the file has been written, exact after. */
  size: number;
  passphrase: string;
  onPassphrase: (value: string) => void;
  downloaded: boolean;
  onDownload: () => void;
  note: string;
  onNote: (value: string) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<'message' | 'link' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [shared, setShared] = useState(false);
  const aboutRef = useRef<HTMLDialogElement>(null);

  const locked = passphrase !== '';
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
  // A phone gets "Share the message…" (straight into a chat, no paste), anything
  // without a share sheet gets "Copy the message". Text only: see the top comment.
  const shareText = canShareText();

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

  const shareMessage = async () => {
    try {
      await navigator.share({ text: message, title: deck.name || 'Four Quarters' });
      setShared(true);
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      await copy('message');
    }
  };

  const withMessages = deck.cards.filter((card) => card.message.trim()).length;
  const withTitles = deck.cards.filter((card) => card.title.trim()).length;

  return (
    <section className="builder-step" aria-labelledby="send-heading">
      <h2 id="send-heading">Name it and send it</h2>

      <label className="builder-field">
        <span>Deck name</span>
        <input
          value={deck.name}
          placeholder="Sam’s birthday"
          maxLength={80}
          onChange={(event) => onName(event.target.value)}
        />
        <small>The heading they see, and the file’s name.</small>
      </label>

      <label className="builder-field">
        <span>A note for them</span>
        <textarea
          value={note}
          rows={3}
          maxLength={NOTE_MAX}
          placeholder="Happy birthday! Put in four quarters…"
          onChange={(event) => onNote(event.target.value)}
        />
        <small>
          {note.length}/{NOTE_MAX} · shown when they open your link
        </small>
      </label>

      <details className="builder-lock" open={locked ? true : undefined}>
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
          Only someone with the passphrase can open it. Tell them in person or send it apart
          from the file — sending both in the same chat protects nothing.
        </p>
      </details>

      <div className="builder-send">
        <ol className="builder-howto">
          <li>
            <button className="builder-primary" onClick={onDownload} disabled={!file}>
              {!file
                ? 'Getting the file ready…'
                : downloaded
                  ? `✓ Downloaded “${fileName}”`
                  : `Download “${fileName}”`}
            </button>
          </li>
          <li>
            {shareText ? (
              <button className="builder-primary" onClick={shareMessage}>
                {shared ? '✓ Shared — share again?' : 'Share the message…'}
              </button>
            ) : (
              <button className="builder-primary" onClick={() => copy('message')}>
                {copied === 'message' ? '✓ Copied' : 'Copy the message'}
              </button>
            )}
          </li>
          <li>
            <span className="builder-howto-title">
              {shareText ? 'In that chat, attach' : 'Paste it in a chat or email and attach'} “
              {fileName}” from your Downloads.
            </span>
          </li>
        </ol>

        <div className="builder-row builder-quiet-row">
          <button className="builder-link" onClick={() => aboutRef.current?.showModal()}>
            What is this?
          </button>
          {shareText ? (
            <button className="builder-link" onClick={() => copy('message')}>
              {copied === 'message' ? '✓ Message copied' : 'Copy the message'}
            </button>
          ) : null}
          <button className="builder-link" onClick={() => copy('link')}>
            {copied === 'link' ? '✓ Link copied' : 'Copy link only'}
          </button>
        </div>
        {copyFailed ? (
          <p className="builder-error">
            This browser would not copy. Open “See the message” below and copy it by hand.
          </p>
        ) : null}
      </div>

      <dialog
        ref={aboutRef}
        className="builder-about"
        aria-labelledby="about-heading"
        // A click on the backdrop lands on the dialog element itself, never on its
        // content, so this closes on an outside click without a wrapper.
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <h3 id="about-heading">Why a file and a message?</h3>
        <p>
          To make sure none of your photos are uploaded anywhere, there is no server: the
          machine runs entirely in your browser, and the only way to get your deck to someone
          else is for you to hand it over yourself.
        </p>
        <p>
          So your photos and messages are packed into one file — locked with a passphrase if you
          want — that you send to whoever you like, the way you would send any photo. No server
          ever sees your photos or your messages.
        </p>
        <ol>
          <li>
            <strong>The file</strong> holds the deck: every picture, title and message.
          </li>
          <li>
            <strong>The message</strong> has your note and a link that opens this machine, ready
            for the file.
          </li>
          <li>They open the link, drop in the file, and put in four quarters.</li>
        </ol>
        <button className="builder-primary" onClick={() => aboutRef.current?.close()}>
          Got it
        </button>
      </dialog>

      <details className="builder-explain">
        <summary>See the message</summary>
        <textarea
          className="builder-preview"
          value={message}
          readOnly
          rows={6}
          aria-label="The message they will get"
          onFocus={(event) => event.currentTarget.select()}
        />
      </details>

      <details className="builder-explain">
        <summary>What’s in the file? · about {humanSize(size)}</summary>
        <ul>
          <li>{plural(deck.cards.length, 'picture', 'pictures')}, shrunk to fit a card</li>
          {withTitles > 0 ? <li>{plural(withTitles, 'title', 'titles')}</li> : null}
          <li>
            {withMessages > 0
              ? `${plural(withMessages, 'message', 'messages')} for the backs of the cards`
              : 'No messages yet — the backs will be blank'}
          </li>
          {deck.name.trim() ? <li>The deck’s name</li> : null}
        </ul>
      </details>

      <div className="builder-step-foot">
        <button onClick={onDone}>Done</button>
        <button className="builder-link" onClick={onBack}>
          ← Back to the cards
        </button>
      </div>
    </section>
  );
}
