import { Environment } from '@react-three/drei';
import { Component, Suspense, type ReactNode } from 'react';
import { asset } from '../../lib/assets';

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
 */
const HDRI_FILE = asset('/hdri/reading_room_2k.hdr');

/**
 * IBL contribution only (no background). Kept low so the env fill never blows out the
 * glossy red enamel + chrome under ACES tone mapping; the explicit warm lights in
 * MachineScene carry the mood, the env just supplies believable reflections.
 */
const ENVIRONMENT_INTENSITY = 0.35;

/**
 * Renders the HDRI as reflections/lighting ONLY (background={false}). Suspends while
 * the file loads (the parent has a null fallback) and is wrapped in an error boundary
 * so a missing or unreadable HDRI never crashes the app.
 */
function ReflectionsHdri(): ReactNode {
  return (
    <Environment
      files={HDRI_FILE}
      background={false}
      environmentIntensity={ENVIRONMENT_INTENSITY}
    />
  );
}

/**
 * Catches an HDRI load failure (Suspense handles pending; this handles the throw) and
 * renders nothing, leaving the scene lit by its explicit lights. One-way: once the
 * env fails we stay in the fallback rather than retry-looping.
 */
class HdriBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/**
 * The environment lighting, safe to drop into the scene: it provides reflections-only
 * IBL when the HDRI is present, and silently no-ops (explicit warm lights remain) when
 * it is not.
 */
export function LibraryEnvironment(): ReactNode {
  return (
    <HdriBoundary>
      <Suspense fallback={null}>
        <ReflectionsHdri />
      </Suspense>
    </HdriBoundary>
  );
}
