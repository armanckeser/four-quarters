import type { ReactNode } from 'react';
import { CabinetBody } from '../components/machine/CabinetBody';
import { Handle } from '../components/machine/Handle';
import { FoldedCardPart } from '../components/machine/FoldedCardPart';
import { celebrationPrints } from '../data/celebration';
import { cabinet, handle, slotX } from '../lib/dimensions';

/**
 * Registry of self-contained machine parts for isolated development. The harness
 * renders the one named in ?part=. Each render must be fully standalone.
 */
export type PartEntry = {
  render: () => ReactNode;
  cameraPosition?: [number, number, number];
  target?: [number, number, number];
};

export const parts: Record<string, PartEntry> = {
  cabinet: {
    render: () => <CabinetBody />,
    cameraPosition: [0.35, 0.12, 0.9],
    target: [0, 0, 0],
  },
  handle: {
    // Read ?status= and ?coins= to preview the mechanism; defaults loading w/ 4.
    render: () => {
      const params = new URLSearchParams(window.location.search);
      const status =
        (params.get('status') as
          | 'loading'
          | 'pushed_in'
          | 'dispensed'
          | 'sold_out'
          | null) ?? 'loading';
      const coins = Number(params.get('coins') ?? '4');
      return <Handle status={status} coins={coins} />;
    },
    cameraPosition: [0.06, 0.09, 0.16],
    target: [0, 0, 0],
  },
  card: {
    // Read ?state= (stowed/dispensed/open) and ?flipped= and ?print= index.
    render: () => {
      const params = new URLSearchParams(window.location.search);
      const state =
        (params.get('state') as 'stowed' | 'dispensed' | 'open' | null) ?? 'open';
      const flipped = params.get('flipped') === 'true';
      const index = Number(params.get('print') ?? '0');
      const item = celebrationPrints[index] ?? celebrationPrints[0];
      return <FoldedCardPart print={item} state={state} flipped={flipped} />;
    },
    cameraPosition: [0, 0.05, 0.3],
    target: [0, 0.05, 0],
  },
  // The card emerging from the REAL machine: cabinet + one handle + the card in its
  // actual Drawer-local frame, so the WHOLE dispense→open→close arc can be checked
  // against the real slit. Params:
  //   ?state=stowed|dispensed|open   (live time-driven path)
  //   ?scrub=0..1                    (DETERMINISTIC keyframe along the whole sequence)
  //   ?angle=front|side              (observer camera; see below)
  //   ?print=<index>                 (0 portrait, 2 landscape, ...)
  // The observer camera is wide enough to see both the lower-band dispense AND the
  // open card resting at the virtual app-camera's viewerDistance (~z=0.69). Used by
  // scripts/contact-sheet.mjs (one page load per frame, so URL-time camera is fine).
  dispense: (() => {
    const params = new URLSearchParams(window.location.search);
    const angle = params.get('angle') ?? 'front';
    const side = angle === 'side';
    return {
      render: () => {
        const state =
          (params.get('state') as 'stowed' | 'dispensed' | 'open' | null) ?? 'dispensed';
        const flipParam = params.get('flip');
        const flipScrubT = flipParam == null ? undefined : Number(flipParam);
        const scrubParam = params.get('scrub');
        // When flipping, hold the open-rest pose (0.85) unless an explicit scrub is given.
        const scrubT =
          scrubParam != null ? Number(scrubParam) : flipScrubT != null ? 0.85 : undefined;
        const index = Number(params.get('print') ?? '0');
        const item = celebrationPrints[index] ?? celebrationPrints[0];
        const handleStatus = state === 'dispensed' ? 'dispensed' : 'loading';
        return (
          <>
            <CabinetBody />
            <group position={[slotX.middle, handle.centerY, cabinet.faceZ + handle.mountZ]}>
              <Handle status={handleStatus} coins={0} />
              <FoldedCardPart
                print={item}
                state={state}
                flipped={false}
                scrubT={scrubT}
                flipScrubT={flipScrubT}
                // The protruding dispensed card is clickable to "take" it (mirrors the
                // real MachineScene wiring); logs so the hit target can be sanity-checked.
                onTake={() => console.info('[harness] card taken')}
              />
            </group>
          </>
        );
      },
      // Frame the whole arc closely (slit at z~-0.03 up to the open card resting at
      // z~0.69), so each tile is legible. FRONT sits on the virtual app-camera axis
      // (the open card faces that way) but nearer; SIDE looks along the arc from the
      // right at arc mid-height to read the lid tip + slide depth in profile.
      cameraPosition: (side ? [0.66, 0.05, 1.12] : [0, 0.02, 1.18]) as [number, number, number],
      target: (side ? [0, 0.0, 0.33] : [0, 0.02, 0.36]) as [number, number, number],
    };
  })(),
};
