/**
 * The canvas renders ON DEMAND (`frameloop="demand"` in App): a frame is drawn only
 * when something asks for one. An idle machine therefore costs nothing — no GPU work,
 * no main-thread work, no battery — which is what lets a phone run it without
 * throttling itself into a slideshow. Before this, the full scene (shadows, contact
 * shadows, post) was redrawn 60 times a second while nobody touched anything.
 *
 * The contract for anything that ANIMATES in a useFrame:
 *   1. step with `frameDelta(delta)`, not the raw delta;
 *   2. call `invalidate()` for as long as it has not settled, so the next frame comes.
 * Prop changes, troika text syncs and OrbitControls moves already request frames.
 */

/** Longest real frame we believe in. Anything longer means the loop was IDLE (on
 *  demand, the clock keeps running between frames, so the first frame after a pause
 *  reports the whole pause as its delta). Damping with that would snap every
 *  animation straight to its end, so treat it as one ordinary frame instead. */
const MAX_REAL_DELTA = 0.2;
const RESUME_DELTA = 1 / 60;

export function frameDelta(delta: number): number {
  return delta > MAX_REAL_DELTA ? RESUME_DELTA : delta;
}
