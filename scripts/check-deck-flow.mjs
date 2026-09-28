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

const DECK_PATH = join(SCRATCH, 'exported.quarters');
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
const saveLabel = (await evalJs(`document.querySelector('.builder-next').textContent`)).value;
ok('next button shows a size', /about \d+ KB/.test(saveLabel), saveLabel);

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
  setValue(document.querySelector('.builder-name'), 'Test deck');
  setValue(document.querySelector('.builder-fields input'), 'A card title');
  'typed'
`)).value;
ok('typing works', typed === 'typed');
await new Promise((r) => setTimeout(r, 900));
ok('rows survive the keystroke', (await evalJs(`document.querySelectorAll('.builder-card').length`)).value === 3);

console.log('\npersisted to IndexedDB');
const stored = (await evalJs(`
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
ok('deck saved with its name', stored.includes('"cards":3') && stored.includes('Test deck'), stored);

console.log('\nthe save step explains the file');
await evalJs(`document.querySelector('.builder-next').click()`);
await new Promise((r) => setTimeout(r, 300));
const saveStep = JSON.parse((await evalJs(`JSON.stringify({
  heading: document.querySelector('#save-heading') && document.querySelector('#save-heading').textContent,
  file: document.querySelector('.builder-file-meta strong') && document.querySelector('.builder-file-meta strong').textContent,
  inside: document.querySelectorAll('.builder-explain li').length,
  current: document.querySelector('[aria-current=step]') && document.querySelector('[aria-current=step]').textContent
})`)).value);
ok('on the save step', saveStep.current === '2Save', saveStep.current);
ok('names the file before downloading', saveStep.file === 'test-deck.quarters', saveStep.file);
ok('lists what is inside', saveStep.inside >= 2, String(saveStep.inside));

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
          size: b.size,
          magic: String.fromCharCode.apply(null, Array.from(all.subarray(0, 8))),
          version: all[8],
          flags: all[9],
          bytes: Array.from(all).join(',')
        }));
      });
      HTMLAnchorElement.prototype.click = realClick;
    };
    document.querySelector('.builder-step .builder-primary').click();
  })
`)).value);
ok('file is a Four Quarters deck', file.magic === 'QUARTERS', `magic=${file.magic} v=${file.version} flags=${file.flags}`);
ok('named from the deck title', file.name === 'test-deck.quarters', file.name);
ok('gzipped, not encrypted', file.flags === 2, 'flags=' + file.flags);
ok('plausible size', file.size > 1000 && file.size < 200000, Math.round(file.size / 1024) + ' KB');

await until('the saved confirmation', `!!document.querySelector('.builder-done')`, 5000);
ok('confirms the download', (await evalJs(`!!document.querySelector('.builder-done')`)).value === true);

console.log('\nthe send step writes the link');
await evalJs(`[...document.querySelectorAll('.builder-step .builder-primary')].find(b => /send/i.test(b.textContent)).click()`);
await new Promise((r) => setTimeout(r, 300));
await evalJs(`
  (() => {
    const el = document.querySelector('#send-note');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Happy birthday & more #1');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()
`);
await new Promise((r) => setTimeout(r, 200));
const preview = (await evalJs(`document.querySelector('.builder-preview').value`)).value;
const link = (preview.match(/https?:\/\/\S+/) ?? [''])[0];
ok('message starts with the note', preview.startsWith('Happy birthday & more #1'), preview.split('\n')[0]);
ok('message names the attachment', preview.includes('test-deck.quarters'));
ok('message carries an invite link', link.includes('#open?'), link);
ok('link carries no pictures', link.length < 400, `${link.length} chars`);

// ---- the recipient's path ---------------------------------------------------
// The half that actually matters: the file arrives on a machine that has never
// seen this deck, and it comes back whole.
console.log('\nopening that file on a clean machine');
writeFileSync(DECK_PATH, Buffer.from(file.bytes.split(',').map(Number)));
console.log(`  wrote exported.quarters (${Math.round(file.size / 1024)} KB)`);

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
ok('drop zone names the file', (invited.drop ?? '').includes('test-deck.quarters'), invited.drop ?? '');

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
  name: document.querySelector('.builder-name').value,
  firstTitle: document.querySelector('.builder-fields input').value,
  error: document.querySelector('.builder-error') ? document.querySelector('.builder-error').textContent : null,
  thumbs: document.querySelectorAll('.builder-thumb img').length
})`)).value);
ok('three cards came back', loaded.rows === 3, `got ${loaded.rows}`);
ok('deck name came back', loaded.name === 'Test deck', loaded.name);
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
