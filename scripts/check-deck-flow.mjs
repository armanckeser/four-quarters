/**
 * Drives the whole deck flow in a real browser: pick photos, watch them shrink,
 * export the file, then open that file on a machine that has never seen it.
 *
 * `check:deck` covers the file format; this covers everything around it — that
 * the picker is wired up, that the machine reloads with the new prints, that a
 * draft survives a refresh, and that a file which is not a deck is refused
 * without taking the loaded deck down with it. None of that is visible to
 * `tsc -b`, and this project has no other test.
 *
 * Needs Chrome and a built app. Start the preview server first:
 *
 *   npm run build && npm run preview -- --port 4178
 *   npm run check:flow
 *
 * Skips with a note rather than failing if Chrome cannot be found, so it is
 * safe to leave in a chain of checks.
 */
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const ORIGIN = process.env.QUARTERS_ORIGIN ?? 'http://localhost:4178/';
const PRINTS = join(process.cwd(), 'src', 'data', 'prints');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join('C:', 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.log('check:flow — no Chrome found, skipping. Set CHROME_PATH to run it.');
  process.exit(0);
}

try {
  await fetch(ORIGIN);
} catch {
  console.log(`check:flow — nothing serving ${ORIGIN}, skipping.`);
  console.log('  Run:  npm run build && npm run preview -- --port 4178');
  process.exit(0);
}

// Its own profile, or Chrome hands the command to an already-running window and
// returns instantly having done nothing.
const PROFILE = mkdtempSync(join(tmpdir(), 'quarters-chrome-'));
const SCRATCH = mkdtempSync(join(tmpdir(), 'quarters-flow-'));
const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--no-first-run', '--remote-debugging-port=9222', `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });

// Tolerant of EBUSY: on Windows Chrome still holds files in its profile for a
// moment after being killed, and a passing run must not fail on the tidy-up.
// What is left behind is a temp directory the OS clears anyway.
const stop = () => {
  try { browser.kill(); } catch {}
  for (const dir of [PROFILE, SCRATCH]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
};
process.on('exit', stop);

let version = null;
for (let i = 0; i < 40 && !version; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  try { version = await (await fetch('http://127.0.0.1:9222/json/version')).json(); } catch {}
}
if (!version) { console.log('check:flow — Chrome did not come up, skipping.'); process.exit(0); }

const DECK_PATH = join(SCRATCH, 'exported.quarters.txt');
const BAD_PATH = join(SCRATCH, 'not-a-deck.quarters');

const tab = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const problems = [];

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const t = m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text ?? '';
    // The HDRI is gitignored (scripts/get-hdri.sh fetches it), so drei's
    // Environment throws on a fresh clone. Pre-existing and documented: the
    // scene degrades to explicit lights.
    if (!/hdri|RGBELoader/i.test(t) && !/reading 'image'/.test(t)) problems.push(t.split('\n')[0]);
  }
};

const evalJs = async (expression, returnByValue = true) =>
  (await send('Runtime.evaluate', { expression, returnByValue, awaitPromise: true })).result;

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

// Poll rather than sleep: resizing photos through a software canvas takes
// anywhere from 2 to 12 seconds depending on what else the machine is doing.
const until = async (label, expr, ms = 45000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if ((await evalJs(expr)).value) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`  (timed out waiting for ${label})`);
  return false;
};

const wipe = () =>
  evalJs(`new Promise(r => { const d = indexedDB.deleteDatabase('halfmoon'); d.onsuccess = d.onerror = d.onblocked = () => r(1); })`);

const settle = async () => {
  await send('Page.reload', {});
  await until('the app to mount', `!!document.querySelector('.builder-open') || !!document.querySelector('.builder')`);
  await new Promise((r) => setTimeout(r, 1500));
};

await send('Runtime.enable');
await send('Page.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: ORIGIN });
await until('the app to mount', `!!document.querySelector('.builder-open')`);
await wipe();
await settle();

console.log('\nopening the builder');
await evalJs(`document.querySelector('.builder-open').click()`);
await new Promise((r) => setTimeout(r, 400));
ok('panel opens', (await evalJs(`!!document.querySelector('.builder')`)).value === true);
ok('starts empty', (await evalJs(`!!document.querySelector('.builder-empty')`)).value === true);

console.log('\nadding three pictures');
const addInput = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.builder input[type=file]')[0]`,
});
await send('DOM.setFileInputFiles', {
  objectId: addInput.result.objectId,
  files: ['cake.svg', 'lighthouse.svg', 'teapot.svg'].map((f) => join(PRINTS, f)),
});
// Wait for the rows themselves: the status line only appears once the first
// resize starts, so "no status" is also true before anything has happened.
await until('shrinking to finish', `document.querySelectorAll('.builder-card').length === 3 || !!document.querySelector('.builder-error')`, 90000);

const addError = (await evalJs(`document.querySelector('.builder-error') ? document.querySelector('.builder-error').textContent : null`)).value;
ok('no error while adding', addError === null, addError ?? '');
ok('three card rows', (await evalJs(`document.querySelectorAll('.builder-card').length`)).value === 3);
ok('empty state gone', (await evalJs(`!document.querySelector('.builder-empty')`)).value === true);
ok('next button enabled', (await evalJs(`!document.querySelector('.builder-next').disabled`)).value === true);

const parsed = JSON.parse((await evalJs(`
  (async () => {
    const out = [];
    for (const img of document.querySelectorAll('.builder-thumb img')) {
      const blob = await (await fetch(img.src)).blob();
      out.push([blob.type, blob.size]);
    }
    return JSON.stringify(out);
  })()
`)).value);
ok('thumbnails present', parsed.length === 3, `${parsed.length} thumbs`);
ok('re-encoded to webp', parsed.length > 0 && parsed.every(([t]) => t === 'image/webp'));
ok('each card under 40 KB', parsed.length > 0 && parsed.every(([, s]) => s < 40000),
   parsed.map(([, s]) => Math.round(s / 1024) + 'K').join(', '));

console.log('\ntyping does not disturb the machine');
const typed = (await evalJs(`
  const setValue = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setValue(document.querySelector('.builder-fields input'), 'A card title');
  'typed'
`)).value;
ok('typing works', typed === 'typed');
await new Promise((r) => setTimeout(r, 900));
ok('rows survive the keystroke', (await evalJs(`document.querySelectorAll('.builder-card').length`)).value === 3);

const readStored = async () => (await evalJs(`
  new Promise((resolve) => {
    const req = indexedDB.open('halfmoon', 1);
    req.onsuccess = () => {
      const get = req.result.transaction('decks').objectStore('decks').get('current');
      get.onsuccess = () => {
        const d = get.result;
        resolve(JSON.stringify(d ? { name: d.name, cards: d.cards.length } : null));
      };
      get.onerror = () => resolve('null');
    };
    req.onerror = () => resolve('null');
  })
`)).value;

console.log('\npersisted to IndexedDB');
ok('deck saved', (await readStored()).includes('"cards":3'), await readStored());

console.log('\nthe send step: name, note, then send');
await evalJs(`document.querySelector('.builder-next').click()`);
await new Promise((r) => setTimeout(r, 300));
ok('on the send step', (await evalJs(`document.querySelector('[aria-current=step]').textContent`)).value === '2Send');
await evalJs(`
  (() => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(document.querySelector('.builder-field input'), 'Test deck');
    set(document.querySelector('.builder-field textarea'), 'Happy birthday & more #1');
  })()
`);
await new Promise((r) => setTimeout(r, 300));
ok('name persisted from the send step', (await readStored()).includes('Test deck'), await readStored());
const sendCard = (await evalJs(`document.querySelector('.builder-send').textContent`)).value;
ok('names the file it will send', sendCard.includes('test-deck.quarters.txt'), sendCard.slice(0, 120));
// Headless desktop Chrome on Linux has no share sheet at all, so it must get
// the download + copy path rather than a Share button that cannot work.
ok('no share sheet: offers the download', /Download test-deck\.quarters\.txt/.test(sendCard) && !/^Share…/.test(sendCard));
await until('the file to be written', `!document.querySelector('.builder-send .builder-primary').disabled`, 10000);

console.log('\nexport writes a real file');
// The download never lands in headless, so intercept the anchor the button
// clicks and read the blob it points at — same bytes, same code path.
const file = JSON.parse((await evalJs(`
  new Promise((resolve) => {
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const name = this.download;
      fetch(this.href).then(function (r) { return r.blob(); }).then(async function (b) {
        const all = new Uint8Array(await b.arrayBuffer());
        resolve(JSON.stringify({
          name: name,
          type: b.type,
          size: b.size,
          text: await b.text(),
          bytes: Array.from(all).join(',')
        }));
      });
      HTMLAnchorElement.prototype.click = realClick;
    };
    document.querySelector('.builder-send .builder-primary').click();
  })
`)).value);
// Plain text with a .txt name: the two things Chromium's share sheet checks.
ok('named from the deck title', file.name === 'test-deck.quarters.txt', file.name);
ok('shared as text/plain', file.type === 'text/plain', file.type);
ok('explains itself', file.text.startsWith('Four Quarters deck: Test deck\n'), file.text.split('\n')[0]);
ok('says where to open it', file.text.includes('go to http://localhost:4178/ and drop this file'));
ok('carries the armored deck', file.text.includes('-----BEGIN FOUR QUARTERS DECK-----') && file.text.includes('-----END FOUR QUARTERS DECK-----'));
ok('plausible size', file.size > 1000 && file.size < 200000, Math.round(file.size / 1024) + ' KB');

await until('the download to be confirmed', `/✓ Downloaded/.test(document.querySelector('.builder-send').textContent)`, 5000);
ok('confirms the download', (await evalJs(`/✓ Downloaded/.test(document.querySelector('.builder-send').textContent)`)).value === true);

console.log('\nthe message carries the link');
const preview = (await evalJs(`document.querySelector('.builder-preview').value`)).value;
const link = (preview.match(/https?:\/\/\S+/) ?? [''])[0];
ok('message starts with the note', preview.startsWith('Happy birthday & more #1'), preview.split('\n')[0]);
ok('message names the attachment', preview.includes('test-deck.quarters.txt'));
ok('message carries an invite link', link.includes('#open?'), link);
ok('link carries no pictures', link.length < 400, `${link.length} chars`);

// ---- the recipient's path ---------------------------------------------------
// The half that actually matters: the file arrives on a machine that has never
// seen this deck, and it comes back whole.
console.log('\nopening that file on a clean machine');
writeFileSync(DECK_PATH, Buffer.from(file.bytes.split(',').map(Number)));
console.log(`  wrote exported.quarters.txt (${Math.round(file.size / 1024)} KB)`);

await wipe();
await send('Page.navigate', { url: 'about:blank' });
await send('Page.navigate', { url: link });
await until('the invite panel', `!!document.querySelector('.receive')`);
const invited = JSON.parse((await evalJs(`JSON.stringify({
  note: document.querySelector('.receive-note') && document.querySelector('.receive-note').textContent,
  heading: document.querySelector('#receive-heading').textContent,
  drop: document.querySelector('.receive-drop') && document.querySelector('.receive-drop').textContent
})`)).value);
ok('link opens with the note', invited.note === 'Happy birthday & more #1', invited.note ?? 'none');
ok('link opens with the deck name', invited.heading === 'Test deck', invited.heading);
ok('drop zone names the file', (invited.drop ?? '').includes('test-deck.quarters.txt'), invited.drop ?? '');

const receiveInput = await send('Runtime.evaluate', { expression: `document.querySelector('.receive input[type=file]')` });
await send('DOM.setFileInputFiles', { objectId: receiveInput.result.objectId, files: [DECK_PATH] });
await until('the deck to load from the link', `/in the machine/.test(document.querySelector('#receive-heading')?.textContent ?? '')`);
ok('loaded from the link', (await evalJs(`/in the machine/.test(document.querySelector('#receive-heading')?.textContent ?? '')`)).value === true);
await evalJs(`document.querySelector('.receive-primary').click()`);
await new Promise((r) => setTimeout(r, 300));
ok('invite cleared from the address bar', (await evalJs(`location.hash`)).value === '');
ok('panel closed', (await evalJs(`!document.querySelector('.receive')`)).value === true);

await evalJs(`document.querySelector('.builder-open').click()`);
await until('the deck to open', `document.querySelectorAll('.builder-card').length === 3`);
// Rows render one tick before their thumbnails: the object URL is minted in an
// effect, so the <img> lands on the following commit.
await until('thumbnails to paint', `document.querySelectorAll('.builder-thumb img').length === 3`, 10000);

const loaded = JSON.parse((await evalJs(`JSON.stringify({
  rows: document.querySelectorAll('.builder-card').length,
  firstTitle: document.querySelector('.builder-fields input').value,
  error: document.querySelector('.builder-error') ? document.querySelector('.builder-error').textContent : null,
  thumbs: document.querySelectorAll('.builder-thumb img').length
})`)).value);
ok('three cards came back', loaded.rows === 3, `got ${loaded.rows}`);
ok('deck name came back', (await readStored()).includes('Test deck'), await readStored());
ok('card title came back', loaded.firstTitle === 'A card title', loaded.firstTitle);
ok('thumbnails rendered', loaded.thumbs === 3, String(loaded.thumbs));
ok('no error shown', loaded.error === null, loaded.error ?? '');

console.log('\na file that is not a deck');
writeFileSync(BAD_PATH, Buffer.from('this is just some text'));
const badInput = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.builder input[type=file]')[1]`,
});
await send('DOM.setFileInputFiles', { objectId: badInput.result.objectId, files: [BAD_PATH] });
await until('an error to appear', `!!document.querySelector('.builder-error')`, 12000);
const badMsg = (await evalJs(`document.querySelector('.builder-error') ? document.querySelector('.builder-error').textContent : null`)).value;
ok('refused with a sentence', badMsg === 'That is not a Four Quarters deck file.', badMsg ?? 'no error');
ok('the good deck survived the bad file', (await evalJs(`document.querySelectorAll('.builder-card').length`)).value === 3);

console.log('\nuncaught exceptions:', problems.length ? '\n  ' + problems.join('\n  ') : ' none');
console.log(`\n${pass} passed, ${fail} failed`);
ws.close();
stop();
process.exit(fail || problems.length ? 1 : 0);
