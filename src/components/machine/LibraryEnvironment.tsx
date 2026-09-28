import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { PMREMGenerator, type WebGLRenderTarget } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { asset } from '../../lib/assets';
import { useContextGeneration } from '../../lib/contextLoss';

/**
 * REFLECTIONS-ONLY image-based lighting. An HDRI feeds the scene's diffuse fill +
 * glossy reflections (the red enamel + chrome need an env map to read as real
 * painted metal), but it is NOT drawn as the background — the cozy bookstore
 * backdrop (see BookstoreBackdrop) is built geometry, so showing a real photo
 * panorama behind it would fight the set and bring back the blown-out window /
 * stray-couch problems we removed.
 *
 * The HDRI is a CC0 equirectangular file from Poly Haven, served from public/ (it is
 * not committed; download it with scripts/get-hdri.sh). If the file is missing or
 * fails to load, the scene degrades to its explicit warm lights — see below.
 *
 * 1k, not 2k: three's PMREM sizes its cube from the source (width / 4), and a 1k
 * equirect is the size its docs call ideal — it fills the 256² cube the glossiest
 * material here can resolve. The 2k file bought a 512² cube (a 24 MB half-float
 * atlas, plus a same-size blur buffer) behind reflections scaled to 0.35, and was a
 * 6 MB download on a phone.
 */
const HDRI_FILE = asset('/hdri/reading_room_1k.hdr');

/**
 * IBL contribution only (no background). Kept low so the env fill never blows out the
 * glossy red enamel + chrome under ACES tone mapping; the explicit warm lights in
 * MachineScene carry the mood, the env just supplies believable reflections.
 */
const ENVIRONMENT_INTENSITY = 0.35;

/**
 * Loads the HDRI, pre-filters it into a PMREM ONCE, and then throws away everything
 * but the result: the decoded equirect and the generator's blur buffer are freed as
 * soon as the environment exists. (drei's <Environment> hands the raw equirect to the
 * renderer, which keeps the source, the atlas and the generator alive for the life of
 * the page.)
 *
 * Silently no-ops — explicit warm lights remain — if the file is missing or unreadable,
 * and requests a frame once the reflections land (the canvas renders on demand).
 */
export function LibraryEnvironment(): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  // The PMREM is the OUTPUT of render passes, so a lost context takes its pixels
  // with it: rebuild it from the file on every restore (the HDR is HTTP-cached).
  const generation = useContextGeneration();

  useEffect(() => {
    let cancelled = false;
    let target: WebGLRenderTarget | null = null;

    new HDRLoader().load(
      HDRI_FILE,
      (equirect) => {
        if (cancelled) {
          equirect.dispose();
          return;
        }
        const generator = new PMREMGenerator(gl);
        target = generator.fromEquirectangular(equirect);
        generator.dispose();
        equirect.dispose();
        scene.environment = target.texture;
        scene.environmentIntensity = ENVIRONMENT_INTENSITY;
        invalidate();
      },
      undefined,
      // Missing / unreadable: stay on the explicit lights. One-way, no retry loop.
      () => undefined,
    );

    return () => {
      cancelled = true;
      if (target && scene.environment === target.texture) scene.environment = null;
      target?.dispose();
    };
  }, [gl, scene, invalidate, generation]);

  return null;
}
