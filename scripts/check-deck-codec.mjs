/**
 * Round-trips the `.quarters` deck format.
 *
 * This repo has no test suite on purpose — `tsc -b` is the correctness gate for
 * a scene whose output is judged by looking at it. The deck format is the one
 * exception, because it is a compatibility contract: a file someone was sent
 * last year has to keep opening, and nobody will notice it stopped until they
 * try. It also has to survive input it did not write, which is not something you
 * check by looking at a screenshot.
 *
 * Runs in plain Node — Blob, WebCrypto, CompressionStream and btoa are all
 * globals there, which is exactly the set the codec uses.
 *
 *   npm run check:deck
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(join(tmpdir(), 'quarters-codec-'));
const bundle = join(out, 'codec.mjs');

try {
  execFileSync(
    'npx',
    ['esbuild', 'src/deck/codec.ts', '--bundle', '--format=esm', '--platform=neutral',
     `--outfile=${bundle}`, '--log-level=warning'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  const { encodeDeck, decodeDeck, deckFileIsEncrypted, deckFileName, isDeckFileName, DeckFileError } =
    await import(pathToFileURL(bundle).href);

  // The share link travels with the file and is just as much untrusted input.
  const inviteBundle = join(out, 'invite.mjs');
  execFileSync(
    'npx',
    ['esbuild', 'src/deck/invite.ts', '--bundle', '--format=esm', '--platform=neutral',
     `--outfile=${inviteBundle}`, '--log-level=warning'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  const { inviteUrl, readInvite, NOTE_MAX } = await import(pathToFileURL(inviteBundle).href);

  let pass = 0;
  let fail = 0;
  const ok = (name, cond, extra = '') => {
    if (cond) {
      pass += 1;
      console.log(`  ok   ${name}${extra ? ' — ' + extra : ''}`);
    } else {
      fail += 1;
      console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`);
    }
  };

  // Real image bytes rather than random noise: base64+gzip behaves differently on
  // compressible input, and the size assertion below is the whole argument for
  // the format. Any file in the repo will do; these are the shipped prints.
  const { readdirSync } = await import('node:fs');
  const dir = 'src/data/prints/';
  const files = readdirSync(dir).slice(0, 6);
  if (files.length === 0) throw new Error('no prints to test with');

  const deck = {
    name: "Sam's birthday",
    cards: files.map((file, i) => ({
      id: `c${i}`,
      title: i === 0 ? '' : `Card ${i}`,
      message: i === 1 ? 'Multi\nline — with "quotes" and 🎠' : '',
      orientation: i % 2 ? 'landscape' : 'portrait',
      image: new Blob([readFileSync(dir + file)], { type: 'image/webp' }),
    })),
  };

  console.log('\nround trip, plain');
  {
    const file = await encodeDeck(deck);
    const back = await decodeDeck(file);
    ok('name survives', back.name === deck.name);
    ok('card count', back.cards.length === deck.cards.length);
    ok('order preserved', back.cards.every((c, i) => c.id === deck.cards[i].id));
    ok('titles survive', back.cards.every((c, i) => c.title === deck.cards[i].title));
    ok('unicode message survives', back.cards[1].message === deck.cards[1].message);
    ok('orientation survives', back.cards.every((c, i) => c.orientation === deck.cards[i].orientation));
    const identical = await Promise.all(
      back.cards.map(async (card, i) =>
        Buffer.from(await card.image.arrayBuffer()).equals(
          Buffer.from(await deck.cards[i].image.arrayBuffer()),
        ),
      ),
    );
    ok('image bytes identical', identical.every(Boolean));
    ok('not flagged encrypted', (await deckFileIsEncrypted(file)) === false);

    // The format's justification: base64 costs a third and gzip gives it back.
    // If this ever drifts far above 1.0, the inline-base64 choice stopped paying
    // for itself and a binary blob section is worth the extra bookkeeping.
    const raw = deck.cards.reduce((total, card) => total + card.image.size, 0);
    const ratio = file.size / raw;
    ok('file is not fatter than its contents', ratio < 1.05, `${ratio.toFixed(3)}x`);
    console.log(`       ${files.length} cards: ${Math.round(raw / 1024)} KB raw -> ${Math.round(file.size / 1024)} KB file`);

    // Decks sent before the rename carry the old magic and must still open.
    const bytes = new Uint8Array(await file.arrayBuffer());
    ok('new decks carry the QUARTERS magic', Buffer.from(bytes.subarray(0, 8)).toString() === 'QUARTERS');
    bytes.set(Buffer.from('HALFMOON'), 0);
    const legacy = await decodeDeck(new Blob([bytes]));
    ok('a pre-rename HALFMOON deck still opens', legacy.cards.length === deck.cards.length);
    ok('.halfmoon is still a deck file name', isDeckFileName('old.halfmoon') && isDeckFileName('new.quarters'));
    ok('other files are not', !isDeckFileName('photo.jpg'));
  }

  console.log('\nround trip, locked');
  {
    const phrase = 'correct horse battery staple';
    const file = await encodeDeck(deck, phrase);
    ok('flagged encrypted', (await deckFileIsEncrypted(file)) === true);

    const back = await decodeDeck(file, phrase);
    ok('opens with the passphrase', back.cards.length === deck.cards.length);
    ok('content intact through crypto', back.cards[1].message === deck.cards[1].message);

    const refuses = async (label, ...args) => {
      let threw = null;
      try {
        await decodeDeck(...args);
      } catch (error) {
        threw = error;
      }
      ok(label, threw instanceof DeckFileError, threw?.message);
    };
    await refuses('wrong passphrase rejected', file, 'wrong');
    await refuses('missing passphrase rejected', file);

    // AES-GCM is authenticated; a flipped byte must fail rather than decrypt to junk.
    const bytes = new Uint8Array(await file.arrayBuffer());
    bytes[bytes.length - 20] ^= 0xff;
    await refuses('tampered file rejected', new Blob([bytes]), phrase);
  }

  console.log('\nhostile and malformed input');
  {
    const cases = [
      ['empty file', new Blob([])],
      ['not a deck', new Blob([Buffer.from('just some text, honestly')])],
      ['right magic, junk body', new Blob([Buffer.from('QUARTERS'), Buffer.from([1, 0, 9, 9, 9])])],
      ['future version', new Blob([Buffer.from('QUARTERS'), Buffer.from([99, 0])])],
    ];
    for (const [name, blob] of cases) {
      let threw = null;
      try {
        await decodeDeck(blob);
      } catch (error) {
        threw = error;
      }
      ok(`${name} -> DeckFileError`, threw instanceof DeckFileError, threw?.message);
    }

    // A manifest that parses but lies. Duplicate ids silently break the
    // collected-set and the thumbnail lookup, and a scriptable mime must never
    // reach a Blob the app will hand to an <img>.
    const evil = {
      name: 42,
      cards: [
        { id: 'dup', title: 'a', message: 'm', mime: 'text/html', data: Buffer.from([1, 2, 3, 4]).toString('base64') },
        { id: 'dup', title: 'b', message: 'm', mime: 'image/webp', data: Buffer.from([5, 6, 7, 8]).toString('base64') },
        { id: 'x', data: 'not base64 !!!!' },
        { id: 'y', title: 'z'.repeat(500), message: 'q'.repeat(9000), mime: 'image/png', data: Buffer.from([9]).toString('base64') },
      ],
    };
    const gz = await new Response(
      new Blob([Buffer.from(JSON.stringify(evil))]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();
    const crafted = new Blob([Buffer.from('QUARTERS'), Buffer.from([1, 2]), Buffer.from(gz)]);
    const back = await decodeDeck(crafted);
    ok('non-string name replaced', back.name === 'Shared deck');
    ok('duplicate ids made unique', new Set(back.cards.map((c) => c.id)).size === back.cards.length);
    ok('scriptable mime rejected', back.cards.every((c) => c.image.type !== 'text/html'));
    ok('undecodable card dropped', back.cards.length === 3, `kept ${back.cards.length}`);
    ok('title clamped', back.cards.every((c) => c.title.length <= 80));
    ok('message clamped', back.cards.every((c) => c.message.length <= 2000));
  }

  console.log('\nfile naming');
  ok('slugified', deckFileName("Sam's birthday!!") === 'sams-birthday.quarters', deckFileName("Sam's birthday!!"));
  ok('nameless falls back', deckFileName('   ') === 'four-quarters-deck.quarters');
  ok('emoji-only falls back', deckFileName('🎠🎠') === 'four-quarters-deck.quarters');

  console.log('\nshare link');
  {
    const base = 'https://example.com/four-quarters/';
    const sent = { note: 'Happy birthday!\nLove, S & A — 🎂 #1?', name: "Sam's birthday", file: 'sams-birthday.quarters', cards: 6, locked: true };
    const url = inviteUrl(base + '#stale', sent);
    ok('link keeps the page path, drops old fragment', url.startsWith(base + '#open?'), url);
    ok('link carries no query string', !new URL(url).search);
    const back = readInvite(new URL(url).hash);
    ok('invite round-trips', JSON.stringify(back) === JSON.stringify(sent), JSON.stringify(back));
    ok('ordinary visit is not an invite', readInvite('') === null && readInvite('#about') === null);
    const unlocked = readInvite(new URL(inviteUrl(base, { ...sent, locked: false, note: '', name: '' })).hash);
    ok('empty note and unlocked survive', unlocked.note === '' && unlocked.name === '' && unlocked.locked === false);

    const hostile = readInvite(
      '#open?note=' + encodeURIComponent('x'.repeat(5000) + '\u0000\u001b') +
      '&file=' + encodeURIComponent('evil.exe') + '&cards=9999&locked=yes&name=' + encodeURIComponent('\u0007bell'),
    );
    ok('note clamped', hostile.note.length === NOTE_MAX, String(hostile.note.length));
    ok('control characters stripped', !/[\u0000-\u0008\u001b]/.test(hostile.note) && hostile.name === 'bell');
    ok('non-deck filename dropped', hostile.file === '');
    ok('implausible card count dropped', hostile.cards === 0);
    ok('only locked=1 means locked', hostile.locked === false);
    ok('garbage does not throw', readInvite('#open?%E0%A4%A') !== undefined);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
