import { useEffect, useState } from 'react';
import { CLOUD_DAYS, cloudAvailable, uploadDeck, type CloudHandle } from './cloud';
import { inviteUrl, NOTE_MAX } from './invite';
import type { Deck } from './types';

/**
 * The builder's last step: name the deck, write a note, and get both to someone.
 *
 * Two ways to send, side by side, because they trade different things:
 *
 *   A link (cloud.ts) — one tap. The deck is sealed here with a key that only
 *     exists inside the link, parked in the deck locker for CLOUD_DAYS, and
 *     the share sheet opens with the note and the link. The recipient taps it
 *     and the machine loads. The price: an unreadable copy sits on a server.
 *
 *   The file — nothing is uploaded. It takes two shares, message then file,
 *     on purpose: Android's share sheet keeps the file and silently drops any
 *     text sent with it, so "one share with both" loses the half that explains
 *     what the attachment is. The file is `.quarters.txt` / text/plain because
 *     Chromium's Web Share refuses file types off its allowlist.
 *
 * Every share has a copy/download fallback for browsers with no share sheet
 * (most desktops), and a file share that fails is remembered and not offered
 * again on that device.
 */

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const SHARE_BROKEN_KEY = 'quarters:txt-share-broken';

function rememberedBroken(): boolean {
  try {
    return window.localStorage.getItem(SHARE_BROKEN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberBroken(): void {
  try {
    window.localStorage.setItem(SHARE_BROKEN_KEY, '1');
  } catch {
    // Private mode: it will just fail over again next time.
  }
}

/** Whether the share sheet will take the deck file. A remembered failure trumps `canShare`. */
function canShareFile(file: File | null): boolean {
  if (!file || rememberedBroken()) return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** Text-only sharing: every browser with a share sheet can do this, Chrome on Android included. */
function canShareText(): boolean {
  return typeof navigator.share === 'function';
}

const isAbort = (failure: unknown) => failure instanceof DOMException && failure.name === 'AbortError';

/** Written for the recipient, who knows nothing: what the link is and what to do with it. */
function linkMessage(note: string, url: string, locked: boolean): string {
  const lines = [];
  if (note.trim()) lines.push(note.trim(), '');
  lines.push('I made you a deck of prints for a little coin machine. Open it here:', url);
  if (locked) lines.push('', "It's locked — I'll tell you the passphrase separately.");
  return lines.join('\n');
}

function fileMessage(note: string, url: string, fileName: string, locked: boolean): string {
  const lines = [];
  if (note.trim()) lines.push(note.trim(), '');
  lines.push(
    `I made you a deck of prints for a little coin machine. I'm sending you a file next (${fileName}) — open this link, then drop the file in:`,
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

type Mode = 'link' | 'file';
type Done = 'link' | 'message' | 'file' | 'copied' | null;

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
  /** The written `.quarters.txt`. null while it is being (re)written after an edit. */
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
  const [mode, setMode] = useState<Mode>(cloudAvailable ? 'link' : 'file');
  const [handle, setHandle] = useState<CloudHandle | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // What has been sent so far, for the ticks. `copied` is the desktop stand-in.
  const [sent, setSent] = useState<Set<Done>>(new Set());
  const [flash, setFlash] = useState<Done>(null);
  const [fileShareFailed, setFileShareFailed] = useState(false);
  // Set when a share was refused for want of a fresh tap (the upload took too
  // long for the browser to still count the original click).
  const [tapAgain, setTapAgain] = useState(false);

  const locked = passphrase !== '';
  const base = window.location.origin + window.location.pathname;
  const common = { note, name: deck.name, cards: deck.cards.length, locked };
  const linkUrl = handle ? inviteUrl(base, { ...common, file: '', cloud: handle }) : null;
  const fileUrl = inviteUrl(base, { ...common, file: fileName, cloud: null });
  const shareFileDirectly = !fileShareFailed && canShareFile(file ?? new File([''], fileName, { type: 'text/plain' }));

  // An uploaded deck is a snapshot. Any edit to the cards, the name or the lock
  // needs a new upload; the note does not, it lives in the link.
  useEffect(() => {
    setHandle(null);
    setTapAgain(false);
    setSent(new Set());
  }, [deck, passphrase]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const mark = (what: Done) => {
    setSent((current) => new Set(current).add(what));
    setFlash(what);
  };

  /**
   * Share sheet if there is one, clipboard if not. `afterWait` marks a call that
   * follows an upload: Safari (and others) only let a page share or copy while
   * the click is fresh, and a second or two of uploading can outlast that. A
   * refusal then is not an error — the link is ready, and one more tap sends it.
   */
  const sendText = async (text: string, what: Done, afterWait = false) => {
    setProblem(null);
    if (canShareText()) {
      try {
        await navigator.share({ text });
        mark(what);
        return;
      } catch (failure) {
        if (isAbort(failure)) return;
        if (failure instanceof DOMException && failure.name === 'NotAllowedError') {
          setTapAgain(true);
          return;
        }
        // Anything else: fall through to the clipboard.
      }
    }
    if (await copyText(text)) mark(what === 'link' ? 'copied' : what);
    else if (afterWait) setTapAgain(true);
    else setProblem('This browser would not copy. Open “See the message” and copy it by hand.');
  };

  const sendLink = async () => {
    let current = handle;
    const fresh = !current;
    if (!current) {
      setProblem(null);
      setUploading(true);
      try {
        current = await uploadDeck(deck, passphrase || undefined);
        setHandle(current);
      } catch (failure) {
        setProblem(failure instanceof Error ? failure.message : 'The deck could not be uploaded.');
        return;
      } finally {
        setUploading(false);
      }
    }
    setTapAgain(false);
    const url = inviteUrl(base, { ...common, file: '', cloud: current });
    await sendText(linkMessage(note, url, locked), 'link', fresh);
  };

  const sendFile = async () => {
    setProblem(null);
    if (!file) return;
    if (shareFileDirectly) {
      try {
        await navigator.share({ files: [file] });
        mark('file');
        return;
      } catch (failure) {
        if (isAbort(failure)) return;
        rememberBroken();
        setFileShareFailed(true);
        setProblem('This browser couldn’t share the file. It has been downloaded instead — attach it from your Downloads.');
      }
    }
    onDownload();
    mark('file');
  };

  const message =
    mode === 'link'
      ? linkMessage(note, linkUrl ?? `${base}#open?…`, locked)
      : fileMessage(note, fileUrl, fileName, locked);

  const withMessages = deck.cards.filter((card) => card.message.trim()).length;
  const withTitles = deck.cards.filter((card) => card.title.trim()).length;
  const tick = (what: Done) => (sent.has(what) ? '✓ ' : '');

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
        <small>The heading they see when they open it.</small>
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
          {note.length}/{NOTE_MAX} · the first thing they read
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
          They’ll need it to open the deck. Tell them in person or in a different chat — sending
          it alongside the deck protects nothing.
        </p>
      </details>

      {cloudAvailable ? (
        <fieldset className="builder-modes">
          <legend>How to send it</legend>
          <label className={mode === 'link' ? 'is-picked' : undefined}>
            <input
              type="radio"
              name="send-mode"
              checked={mode === 'link'}
              onChange={() => setMode('link')}
            />
            <span>
              <span>
                <strong>Send a link</strong> <em>easiest</em>
              </span>
              <small>
                One tap to send, one tap to open. Stored encrypted for {CLOUD_DAYS} days — the
                key is only in the link, so no one else can see it.
              </small>
            </span>
          </label>
          <label className={mode === 'file' ? 'is-picked' : undefined}>
            <input
              type="radio"
              name="send-mode"
              checked={mode === 'file'}
              onChange={() => setMode('file')}
            />
            <span>
              <strong>Send the file</strong>
              <small>
                Nothing is uploaded and it never expires. Two sends: a message, then the file,
                which they drop onto the page.
              </small>
            </span>
          </label>
        </fieldset>
      ) : null}

      <div className="builder-send">
        {mode === 'link' ? (
          <>
            <button className="builder-primary" onClick={sendLink} disabled={uploading}>
              {uploading
                ? 'Locking and uploading…'
                : `${tick('link') || tick('copied')}${
                    tapAgain
                      ? canShareText()
                        ? 'Link ready — tap to share'
                        : 'Link ready — click to copy'
                      : canShareText()
                        ? 'Share link…'
                        : 'Copy message with link'
                  }`}
            </button>
            {flash === 'copied' ? (
              <p className="builder-done" role="status">
                ✓ Copied. Paste it into a chat or email.
              </p>
            ) : null}
            <div className="builder-row builder-quiet-row">
              {linkUrl ? (
                <button
                  className="builder-link"
                  onClick={async () => {
                    if (await copyText(linkUrl)) setFlash('message');
                  }}
                >
                  {flash === 'message' ? '✓ Link copied' : 'Copy link only'}
                </button>
              ) : null}
              <button className="builder-link" onClick={onDownload} disabled={!file}>
                {downloaded ? '✓ Backup saved' : 'Save a backup copy'}
              </button>
            </div>
          </>
        ) : (
          <>
            <ol className="builder-howto">
              <li>
                <button className="builder-primary" onClick={() => sendText(message, 'message')}>
                  {tick('message')}
                  {canShareText() ? 'Share the message…' : 'Copy the message'}
                </button>
              </li>
              <li>
                <button className="builder-primary" onClick={sendFile} disabled={!file}>
                  {tick('file') || (downloaded ? '✓ ' : '')}
                  {shareFileDirectly ? 'Share the file…' : `Download ${fileName}`}
                </button>
              </li>
            </ol>
            <p className="builder-hint">
              {shareFileDirectly
                ? 'Send both to the same chat.'
                : `Paste the message into a chat or email, then attach ${fileName} from your Downloads.`}
            </p>
            {flash === 'message' && !canShareText() ? (
              <p className="builder-done" role="status">
                ✓ Copied. Paste it into a chat or email.
              </p>
            ) : null}
          </>
        )}
        {problem ? <p className="builder-error">{problem}</p> : null}
      </div>

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
        <summary>What’s in it? · about {humanSize(size)}</summary>
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
        <p>
          {mode === 'link'
            ? `A link uploads this, encrypted on your device first. The key to open it is part of the link and never reaches the server, which deletes it after ${CLOUD_DAYS} days.`
            : 'A file goes only where you send it. Nothing is uploaded.'}
        </p>
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
