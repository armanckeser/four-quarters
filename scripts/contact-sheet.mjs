// Dev tool: render the card animation as a single CONTACT SHEET image.
//
// Drives the `dispense` harness part in DETERMINISTIC scrub mode (?scrub=t) across N
// evenly-spaced keyframes. For EACH t it captures a FRONT and a SIDE observer view
// and stitches them side-by-side into ONE paired tile (front | side), labelled with
// its t value, so every keyframe shows both angles together (more contextual than
// two separate blocks). The paired tiles are then tiled into one PNG grid.
//
// Usage:
//   node scripts/contact-sheet.mjs [--frames 24] [--print 0] [--out /tmp/hm-shots/sheet.png]
//   [--url http://localhost:5174] [--cols 4] [--w 360] [--h 360]
//
// Requires: dev server running (default :5174), `agent-browser` and `magick` on PATH.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] != null ? args[index + 1] : fallback;
};

const FRAMES = Number(getArg('frames', '24'));
const PRINT = Number(getArg('print', '0'));
// COLS counts PAIRED tiles per row (each tile is front|side). 4 pairs => 8 sub-images wide.
const COLS = Number(getArg('cols', '4'));
const VIEW_W = Number(getArg('w', '360'));
const VIEW_H = Number(getArg('h', '360'));
const BASE_URL = getArg('url', 'http://localhost:5174');
const OUT = getArg('out', `/tmp/hm-shots/sheet-print${PRINT}.png`);
const FRAME_DIR = '/tmp/hm-shots/frames';
const WAIT_MS = Number(getArg('wait', '700'));

const ab = (...a) => execFileSync('agent-browser', a, { stdio: ['ignore', 'pipe', 'pipe'] });
const mg = (...a) => execFileSync('magick', a, { stdio: ['ignore', 'pipe', 'pipe'] });

rmSync(FRAME_DIR, { recursive: true, force: true });
mkdirSync(FRAME_DIR, { recursive: true });
mkdirSync('/tmp/hm-shots', { recursive: true });

ab('set', 'viewport', String(VIEW_W), String(VIEW_H));

const shoot = (angle, t, file) => {
  const url = `${BASE_URL}/harness.html?part=dispense&scrub=${t.toFixed(4)}&angle=${angle}&print=${PRINT}`;
  ab('open', url);
  ab('wait', String(WAIT_MS));
  ab('screenshot', file);
};

const pairTiles = [];
for (let i = 0; i < FRAMES; i += 1) {
  const t = FRAMES === 1 ? 0 : i / (FRAMES - 1);
  const frontRaw = join(FRAME_DIR, `front-${String(i).padStart(2, '0')}.png`);
  const sideRaw = join(FRAME_DIR, `side-${String(i).padStart(2, '0')}.png`);
  shoot('front', t, frontRaw);
  shoot('side', t, sideRaw);

  // Stitch FRONT | SIDE into one paired tile, with a thin divider + a shared t label.
  const pair = join(FRAME_DIR, `pair-${String(i).padStart(2, '0')}.png`);
  mg(frontRaw, sideRaw, '+append', '-bordercolor', '#bdb7a8', '-border', '1', pair);
  mg(pair, '-gravity', 'NorthWest', '-pointsize', '18', '-fill', '#ffffff',
    '-undercolor', '#00000099', '-annotate', '+4+2', ` t=${t.toFixed(2)} `, pair);
  pairTiles.push(pair);
  process.stdout.write(`\r${i + 1}/${FRAMES}   `);
}
process.stdout.write('\n');

mg('montage', ...pairTiles, '-tile', `${COLS}x`, '-geometry', '+3+3',
  '-background', '#efece4', OUT);

console.log(`\nContact sheet: ${OUT}  (${FRAMES} t-points, front|side paired, ${COLS} pairs/row)`);
