import { useCallback, useEffect, useRef, useState } from 'react';
import { useDeckContext } from './DeckProvider';
import { encodeDeck, deckFileName, isDeckFileName, DeckFileError } from './codec';
import { orientationOf, prepareImage } from './images';
import { MAX_CARDS, newCardId, type Deck, type DeckCard } from './types';
import './builder.css';

/**
 * Loading the machine with your own prints.
 *
 * Edits land on the machine immediately rather than behind a "preview" button:
 * the thing you are making is a physical object in the scene behind this panel,
 * and watching the grid fill as you add photos is most of the pleasure of it.
 * That also means there is no draft/published split to explain — the deck on the
 * machine IS the deck, and exporting just writes it to a file.
 */

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Sum of the stored artwork. The written file lands within a few percent of this. */
function deckBytes(deck: Deck): number {
  return deck.cards.reduce((total, card) => total + card.image.size, 0);
}

export function Builder({ onClose }: { onClose: () => void }) {
  const { deck, useDeck, useBundled, openFile, fileNeedsPassphrase } = useDeckContext();
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLInputElement>(null);

  const current: Deck = deck ?? { name: '', cards: [] };

  const update = useCallback(
    (next: Deck | ((live: Deck | null) => Deck)) => {
      setError(null);
      useDeck(next);
    },
    [useDeck],
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const picked = Array.from(files).filter((file) => file.type.startsWith('image/'));
      if (picked.length === 0) {
        setError('Those did not look like images.');
        return;
      }
      const room = MAX_CARDS - current.cards.length;
      if (room <= 0) {
        setError(`A deck holds ${MAX_CARDS} cards. Remove one to add another.`);
        return;
      }

      setError(null);
      const added: DeckCard[] = [];
      const failed: string[] = [];
      for (const [index, file] of picked.slice(0, room).entries()) {
        setWorking(`Shrinking ${index + 1} of ${Math.min(picked.length, room)}…`);
        try {
          const { blob, width, height } = await prepareImage(file);
          added.push({
            id: newCardId(),
            title: '',
            message: '',
            orientation: orientationOf(width, height),
            image: blob,
          });
        } catch {
          failed.push(file.name);
        }
      }
      setWorking(null);

      // Appended to whatever the deck is NOW, not to the copy captured before the
      // resizing started: dropping a second batch of pictures mid-shrink is easy
      // to do, and the losing write would take the first batch with it silently.
      if (added.length > 0) {
        update((live) => ({
          name: live?.name ?? current.name,
          cards: [...(live?.cards ?? []), ...added],
        }));
      }
      if (failed.length > 0) setError(`Could not read: ${failed.join(', ')}`);
      else if (picked.length > room) setError(`Only the first ${room} fit — a deck holds ${MAX_CARDS}.`);
    },
    [current, update],
  );

  // A file dropped anywhere is meant for the machine, so the whole window takes
  // it rather than a strip of panel the user has to aim at. `.quarters` opens a
  // deck; images join the one being built.
  useEffect(() => {
    const over = (event: DragEvent) => event.preventDefault();
    const drop = async (event: DragEvent) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const deckFile = files.find((file) => isDeckFileName(file.name));
      if (deckFile) {
        await openDeckFile(deckFile);
        return;
      }
      await addFiles(files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  });

  async function openDeckFile(file: File) {
    setError(null);
    setWorking('Opening…');
    try {
      let phrase: string | undefined;
      if (await fileNeedsPassphrase(file)) {
        // A prompt is a blunt instrument, but a locked deck is rare and the
        // alternative is a modal that exists solely to ask one question.
        phrase = window.prompt('That deck is locked. Passphrase:') ?? undefined;
        if (!phrase) {
          setWorking(null);
          return;
        }
      }
      await openFile(file, phrase);
      setPassphrase('');
    } catch (failure) {
      setError(failure instanceof DeckFileError ? failure.message : 'That deck could not be opened.');
    } finally {
      setWorking(null);
    }
  }

  async function saveDeckFile() {
    if (current.cards.length === 0) return;
    setWorking('Writing the deck…');
    setError(null);
    try {
      const blob = await encodeDeck(current, passphrase || undefined);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = deckFileName(current.name);
      link.click();
      // Revoked on a turn of the event loop: revoking synchronously races the
      // browser's own read of the href and produces an empty download.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError('The deck could not be written.');
    } finally {
      setWorking(null);
    }
  }

  const patch = (id: string, fields: Partial<DeckCard>) =>
    update({
      ...current,
      cards: current.cards.map((card) => (card.id === id ? { ...card, ...fields } : card)),
    });

  const move = (id: string, delta: number) => {
    const from = current.cards.findIndex((card) => card.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.cards.length) return;
    const cards = [...current.cards];
    [cards[from], cards[to]] = [cards[to], cards[from]];
    update({ ...current, cards });
  };

  const remove = (id: string) =>
    update({ ...current, cards: current.cards.filter((card) => card.id !== id) });

  return (
    <div className="builder">
      <header className="builder-head">
        <input
          className="builder-name"
          value={current.name}
          placeholder="Name this deck"
          maxLength={80}
          onChange={(event) => update({ ...current, name: event.target.value })}
        />
        <button className="builder-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <p className="builder-note">Pictures stay on this device. Nothing is uploaded.</p>

      <div className="builder-actions">
        <button onClick={() => addRef.current?.click()} disabled={working !== null}>
          Add pictures
        </button>
        <button onClick={() => openRef.current?.click()} disabled={working !== null}>
          Open deck
        </button>
        {deck ? (
          <button className="builder-quiet" onClick={useBundled} disabled={working !== null}>
            Use sample prints
          </button>
        ) : null}
        <input
          ref={addRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <input
          ref={openRef}
          type="file"
          accept=".quarters,.halfmoon"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openDeckFile(file);
            event.target.value = '';
          }}
        />
      </div>

      {working ? <p className="builder-status">{working}</p> : null}
      {error ? <p className="builder-error">{error}</p> : null}

      {current.cards.length === 0 ? (
        <button
          className="builder-empty"
          onClick={() => addRef.current?.click()}
          disabled={working !== null}
        >
          Tap or drop pictures here
        </button>
      ) : (
        <ol className="builder-cards">
          {current.cards.map((card, index) => (
            <CardRow
              key={card.id}
              card={card}
              index={index}
              last={index === current.cards.length - 1}
              onPatch={patch}
              onMove={move}
              onRemove={remove}
            />
          ))}
        </ol>
      )}

      <footer className="builder-foot">
        <label className="builder-lock">
          <span>Passphrase</span>
          <input
            type="password"
            value={passphrase}
            placeholder="optional"
            autoComplete="new-password"
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        <p className="builder-lock-note">Send it separately from the file.</p>
        <button
          className="builder-save"
          onClick={saveDeckFile}
          disabled={current.cards.length === 0 || working !== null}
        >
          Save deck file{current.cards.length > 0 ? ` · about ${humanSize(deckBytes(current))}` : ''}
        </button>
      </footer>
    </div>
  );
}

/** One card's row. Split out so typing in a message does not re-render every sibling. */
function CardRow({
  card,
  index,
  last,
  onPatch,
  onMove,
  onRemove,
}: {
  card: DeckCard;
  index: number;
  last: boolean;
  onPatch: (id: string, fields: Partial<DeckCard>) => void;
  onMove: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(card.image);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [card.image]);

  return (
    <li className="builder-card">
      <div className="builder-thumb">
        {thumb ? <img src={thumb} alt="" /> : null}
        <span className="builder-index">{index + 1}</span>
      </div>
      <div className="builder-fields">
        <input
          value={card.title}
          placeholder="Title (optional)"
          maxLength={80}
          onChange={(event) => onPatch(card.id, { title: event.target.value })}
        />
        <textarea
          value={card.message}
          placeholder="Message on the back (optional)"
          maxLength={2000}
          rows={2}
          onChange={(event) => onPatch(card.id, { message: event.target.value })}
        />
      </div>
      <div className="builder-card-actions">
        <button onClick={() => onMove(card.id, -1)} disabled={index === 0} aria-label="Move up">
          ↑
        </button>
        <button onClick={() => onMove(card.id, 1)} disabled={last} aria-label="Move down">
          ↓
        </button>
        <button onClick={() => onRemove(card.id)} aria-label="Remove this card">
          ✕
        </button>
      </div>
    </li>
  );
}
