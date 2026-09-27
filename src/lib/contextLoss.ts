import { useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';

/**
 * Surviving a LOST WebGL context. A phone's GPU process can drop every WebGL
 * context on the page (memory pressure, a driver reset, the tab going to the
 * background) and then hand them back. three already handles the restore itself —
 * it rebuilds its GL state and re-uploads geometry and image textures on the next
 * render — but two things here do not come back on their own:
 *
 *   1. The next render. The canvas renders ON DEMAND (lib/frameloop.ts), so after a
 *      restore nothing asks for a frame and the page stays blank until someone
 *      happens to touch it. That was the phone "white screen": the console showed
 *      "Context Restored" and then nothing ever drew again.
 *   2. Anything RENDERED on the GPU rather than uploaded from the CPU — the PMREM
 *      reflection map is the output of render passes, so its pixels die with the
 *      context and have to be made again (LibraryEnvironment keys on this).
 *
 * Returns a counter that bumps on every restore, and requests a frame when it does.
 */
export function useContextGeneration(): number {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const canvas = gl.domElement;
    const restored = () => setGeneration((value) => value + 1);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => canvas.removeEventListener('webglcontextrestored', restored);
  }, [gl]);

  useEffect(() => {
    if (generation) invalidate();
  }, [generation, invalidate]);

  return generation;
}

/** Mounted once inside the Canvas: redraws the scene after a restored context. */
export function ContextRecovery(): null {
  useContextGeneration();
  return null;
}
