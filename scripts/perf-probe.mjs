/**
 * Measures what the scene costs a phone, in numbers that do not depend on the GPU
 * of whatever machine runs it: draw calls per frame, frames rendered while nobody
 * touches anything, GPU memory handed to textures + render targets, shader
 * programs linked, bytes downloaded, and main-thread time. Runs the built app in
 * Chrome under phone emulation (390×844 @3x, touch, 4× CPU throttle).
 *
 * A desktop GPU hides every one of these costs behind vsync, which is how the
 * scene ended up unable to run on a phone without anyone noticing. Numbers, not
 * "feels smooth on my laptop".
 *
 *   npm run build && npm run preview -- --port 4178
 *   npm run check:perf                 # phone profile
 *   npm run check:perf -- --desktop    # 1440×900 @1x, no throttle
 *
 * Also writes a screenshot (PERF_SHOT, default: the temp dir) so the look can be
 * compared, and PERF_BIG=1 lists every GPU allocation over 1 MB. The idle main-thread
 * figure includes this script's own requestAnimationFrame counter (~30 ms).
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const ORIGIN = process.env.QUARTERS_ORIGIN ?? 'http://localhost:4178/';
const desktop = process.argv.includes('--desktop');
const profile = desktop ? 'desktop' : 'phone';
const shotPath = process.env.PERF_SHOT ?? join(tmpdir(), `quarters-perf-${profile}.png`);

const chrome = [
  process.env.CHROME_PATH,
  join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
if (!chrome) { console.log('perf-probe — no Chrome found.'); process.exit(0); }

const PROFILE = mkdtempSync(join(tmpdir(), 'quarters-perf-'));
const PORT = 9333;
const browser = spawn(chrome, [
  '--headless=new', '--no-first-run', '--ignore-gpu-blocklist', '--enable-gpu',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });
const stop = () => {
  try { browser.kill(); } catch {}
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
};
process.on('exit', stop);

let version = null;
for (let i = 0; i < 40 && !version; i += 1) {
  await new Promise((r) => setTimeout(r, 400));
  try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch {}
}
if (!version) { console.log('perf-probe — Chrome did not come up.'); process.exit(1); }

const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
let bytesIn = 0;
const errors = [];
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Network.loadingFinished') bytesIn += m.params.encodedDataLength;
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
};
const evalJs = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;

// Instrument WebGL before any page script runs. Counts are per-context, summed.
const INSTRUMENT = `(() => {
  const s = window.__perf = { big: [], draws: 0, frames: 0, drawFrames: 0, texBytes: 0, rbBytes: 0, programs: 0, frameDraws: [] };
  let drawsThisFrame = 0;
  const bpp = (format, type) => {
    const ch = { 0x1908: 4, 0x1907: 3, 0x8227: 2, 0x1903: 1, 0x8058: 4, 0x881A: 4, 0x8814: 4, 0x822E: 1, 0x822D: 1, 0x8230: 2, 0x8229: 1, 0x1902: 1, 0x88F0: 1, 0x81A6: 1, 0x8CAC: 1, 0x8C43: 4, 0x8D62: 3 }[format] ?? 4;
    const b = { 0x1406: 4, 0x140B: 2, 0x8D61: 2, 0x1405: 4, 0x1403: 2, 0x84FA: 4, 0x1401: 1 }[type] ?? 1;
    return ch * b;
  };
  const size = (a) => {
    for (const x of a) if (x && typeof x === 'object' && 'width' in x && 'height' in x && x.width) return x.width * x.height;
    return 0;
  };
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const p = C.prototype;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const f = p[name]; if (!f) continue;
      p[name] = function (...a) { if (!s.draws) s.firstDraw = performance.now(); s.draws += 1; drawsThisFrame += 1; return f.apply(this, a); };
    }
    const ti = p.texImage2D;
    p.texImage2D = function (...a) {
      // (target, level, internalformat, width, height, border, format, type, pixels) or (target, level, internalformat, format, type, source)
      if (a[1] === 0) {
        if (a.length >= 8 && typeof a[3] === 'number') { const n = a[3] * a[4] * bpp(a[6], a[7]); s.texBytes += n; if (n > 1e6) s.big.push(['tex', a[3], a[4], a[6].toString(16), a[7].toString(16), !!a[8], (n/1048576).toFixed(1)]); }
        else s.texBytes += size(a.slice(5)) * bpp(a[3], a[4]);
      }
      return ti.apply(this, a);
    };
    if (p.texStorage2D) {
      const ts = p.texStorage2D;
      p.texStorage2D = function (t, levels, fmt, w, h) {
        const b = { 0x8058: 4, 0x881A: 8, 0x8814: 16, 0x88F0: 4, 0x81A6: 4, 0x8CAC: 4, 0x8C43: 4, 0x822F: 4, 0x8230: 8 }[fmt] ?? 4;
        const n = w * h * b * (levels > 1 ? 1.33 : 1) * (t === 0x8513 ? 6 : 1); s.texBytes += n; if (n > 1e6) s.big.push(['storage', w, h, fmt.toString(16), levels, (n/1048576).toFixed(1)]);
        return ts.call(this, t, levels, fmt, w, h);
      };
    }
    const rb = p.renderbufferStorage;
    p.renderbufferStorage = function (t, f, w, h) { s.rbBytes += w * h * 4; return rb.call(this, t, f, w, h); };
    if (p.renderbufferStorageMultisample) {
      const rbm = p.renderbufferStorageMultisample;
      p.renderbufferStorageMultisample = function (t, n, f, w, h) { s.rbBytes += w * h * 4 * Math.max(1, n); return rbm.call(this, t, n, f, w, h); };
    }
    const lp = p.linkProgram;
    p.linkProgram = function (...a) { s.programs += 1; return lp.apply(this, a); };
  }
  const raf = window.requestAnimationFrame.bind(window);
  const tick = () => {
    s.frames += 1;
    if (drawsThisFrame) { s.drawFrames += 1; s.frameDraws.push(drawsThisFrame); if (s.frameDraws.length > 600) s.frameDraws.shift(); }
    drawsThisFrame = 0;
    raf(tick);
  };
  raf(tick);
})();`;

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Performance.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });
if (desktop) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

const t0 = Date.now();
await send('Page.navigate', { url: ORIGIN });
// "Ready" = the scene has drawn the machine and stopped allocating GPU memory.
let ready = null;
let lastTex = -1;
let stable = 0;
while (Date.now() - t0 < 90000) {
  await new Promise((r) => setTimeout(r, 500));
  const p = await evalJs('window.__perf && { d: window.__perf.draws, t: window.__perf.texBytes + window.__perf.rbBytes }');
  if (!p || p.d === 0) continue;
  if (p.t === lastTex) stable += 1; else { stable = 0; lastTex = p.t; }
  if (stable >= 6) { ready = Date.now() - t0 - 3000; break; }
}

const metric = async (name) => (await send('Performance.getMetrics')).metrics.find((m) => m.name === name)?.value ?? 0;
const before = await evalJs('({ ...window.__perf, frameDraws: undefined })');
const loadTask = await metric('TaskDuration');
const taskBefore = await metric('TaskDuration');
await new Promise((r) => setTimeout(r, 5000));
const after = await evalJs('({ ...window.__perf, frameDraws: window.__perf.frameDraws.slice(-60), big: window.__perf.big })');
const taskAfter = await metric('TaskDuration');

const idleRenderFrames = after.drawFrames - before.drawFrames;
const draws = after.frameDraws.length ? Math.max(...after.frameDraws) : 0;

// Poke the camera (a drag) so an on-demand renderer draws at least one frame, and
// read what a single interactive frame costs.
if (draws === 0) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 400, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 230, y: 400, button: 'left' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 230, y: 400, button: 'left' });
  await new Promise((r) => setTimeout(r, 1500));
}
const interactive = await evalJs('window.__perf.frameDraws.slice(-5)');
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
console.log(`perf-probe (${profile})`);
console.log(`  first frame drawn     ${(before.firstDraw / 1000).toFixed(1)} s`);
console.log(`  main thread to ready  ${(loadTask).toFixed(1)} s`);
console.log(`  ready after           ${ready == null ? 'never' : (ready / 1000).toFixed(1) + ' s'}`);
console.log(`  downloaded            ${mb(bytesIn)}`);
console.log(`  GPU textures          ${mb(after.texBytes)}`);
console.log(`  GPU renderbuffers     ${mb(after.rbBytes)}`);
console.log(`  shader programs       ${after.programs}`);
console.log(`  draw calls / frame    ${draws || Math.max(0, ...interactive)}`);
console.log(`  frames drawn, 5s idle ${idleRenderFrames}`);
console.log(`  main thread, 5s idle  ${((taskAfter - taskBefore) * 1000).toFixed(0)} ms`);
if (process.env.PERF_BIG) console.log(JSON.stringify(after.big));
if (errors.length) console.log('  errors:\n    ' + errors.join('\n    '));
console.log(`  screenshot            ${shotPath}`);
stop();
process.exit(0);
