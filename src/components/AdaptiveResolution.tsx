import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { initialDpr, quality } from '../lib/quality';

/**
 * Steps the canvas pixel ratio down on a device that cannot hold its frame rate, and
 * back up when it recovers. The one quality knob that moves at runtime — everything
 * else in the scene is fixed so the machine looks the same on every device.
 *
 * Not drei's PerformanceMonitor: that one averages frames over wall-clock windows,
 * and with the ON-DEMAND frameloop an idle second holds one frame, which it reads as
 * 1 fps and would drop the resolution the moment anyone stopped touching the screen.
 * This samples only CONSECUTIVE frames (gap under ~0.1 s), i.e. while something is
 * actually animating, which is exactly when frame rate is felt.
 */
const SAMPLE = 45; // consecutive frames per verdict
const SLOW_FPS = 45; // below this, drop resolution
const FAST_FPS = 57; // above this (with headroom to spare), raise it back
const STEP = 0.25;
const MAX_FLIPS = 4; // stop adapting if it keeps oscillating; settle low

export function AdaptiveResolution() {
  const setDpr = useThree((state) => state.setDpr);
  const lastTime = useRef(0);
  const deltas = useRef<number[]>([]);
  const dpr = useRef(initialDpr());
  const lastDirection = useRef(0);
  const flips = useRef(0);

  useFrame(() => {
    if (flips.current >= MAX_FLIPS) return;
    const now = performance.now();
    const gap = (now - lastTime.current) / 1000;
    lastTime.current = now;
    if (gap > 0.1) {
      // A pause (on-demand idle) is not a slow frame: start a fresh run.
      deltas.current.length = 0;
      return;
    }
    deltas.current.push(gap);
    if (deltas.current.length < SAMPLE) return;

    const sorted = [...deltas.current].sort((a, b) => a - b);
    const fps = 1 / sorted[Math.floor(sorted.length / 2)];
    deltas.current.length = 0;

    const ceiling = Math.min(quality.maxDpr, window.devicePixelRatio || 1);
    let direction = 0;
    if (fps < SLOW_FPS && dpr.current > quality.minDpr) direction = -1;
    else if (fps > FAST_FPS && dpr.current < ceiling) direction = 1;
    if (!direction) return;

    if (lastDirection.current && direction !== lastDirection.current) flips.current += 1;
    lastDirection.current = direction;
    dpr.current = Math.min(ceiling, Math.max(quality.minDpr, dpr.current + direction * STEP));
    // Oscillation cap reached: park at the lower of the two levels it bounced between.
    if (flips.current >= MAX_FLIPS && direction > 0) dpr.current -= STEP;
    setDpr(dpr.current);
  });

  return null;
}
