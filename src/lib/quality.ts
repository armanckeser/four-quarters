/**
 * How much GPU the scene may assume. Decided ONCE at load from the device, never per
 * frame, so the look is stable (the dpr is the only thing that adapts at runtime —
 * see App's PerformanceMonitor).
 *
 * A phone is not a slow desktop: its GPU shares a small memory budget with the page,
 * and iOS Safari kills a tab that crosses it instead of slowing down. So the phone
 * tier is about MEMORY first (smaller shadow map, lower dpr ceiling) and the scene
 * itself is kept identical across tiers — the same meshes, materials and lights —
 * so a phone sees the same machine, not a cheapened one.
 */
export type QualityTier = 'phone' | 'desktop';

function detectTier(): QualityTier {
  if (typeof window === 'undefined') return 'desktop';
  // A coarse primary pointer is the reliable "this is a touch device" signal; the
  // screen check keeps a touchscreen laptop on the desktop tier.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(window.screen.width, window.screen.height) <= 900;
  return coarse && small ? 'phone' : 'desktop';
}

export const qualityTier: QualityTier = detectTier();

export const quality = {
  /** Upper bound on the canvas pixel ratio. A 3× phone at 3× renders 9× the pixels of
   *  1× for text that already reads crisp at ~2×. */
  maxDpr: 2,
  /** Floor the adaptive dpr may drop to on a device that cannot hold its frame rate. */
  minDpr: 1,
  /** Key-light shadow map edge. With the fitted shadow frustum (see MachineScene)
   *  1024 is already finer than the old 2048 map spread over 10 m. */
  shadowMapSize: qualityTier === 'phone' ? 1024 : 2048,
  /** Multisampled default framebuffer. A phone draws at ~2x dpr, where the extra
   *  pixels already do the anti-aliasing, and 4x MSAA would multiply the size of the
   *  largest buffer on the page — on a GPU that shares memory with the tab and whose
   *  driver resets (losing every WebGL context) when pushed. Desktop keeps it. */
  antialias: qualityTier !== 'phone',
} as const;

/** The device's own pixel ratio, clamped to the tier's range: where the canvas starts
 *  before AdaptiveResolution has seen any frames. */
export function initialDpr(): number {
  return Math.min(quality.maxDpr, Math.max(quality.minDpr, window.devicePixelRatio || 1));
}
