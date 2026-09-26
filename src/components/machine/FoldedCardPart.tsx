import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import {
  CanvasTexture,
  Euler,
  Group,
  MathUtils,
  Matrix4,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { CelebrationPrint } from '../../data/celebration';
import { usePhotoTexture } from '../../lib/textures';
import { LABEL_FONT, cabinet, card, lowerPanel, print } from '../../lib/dimensions';

export type CardState = 'stowed' | 'dispensed' | 'open';

/**
 * Shared scroll state for the open card's back-face message, held in a ref by the scene
 * (never React state — it's read/written every frame). `target` is the desired scroll
 * offset in world metres (0 = top); the open card eases its visible offset toward it and
 * clamps to `[0, max]`. `max` is the measured overflow (block height − window height),
 * written by the card once troika reports the text bounds.
 */
export type MessageScrollState = { target: number; max: number };

/**
 * Ordered phases of the open/dispense motion. The card eases toward ONE phase's
 * target at a time and only advances when that motion has converged (or its time
 * budget elapses), so transforms never blend simultaneously — which is what kept
 * the old single-blend version tumbling through the handle and glass.
 */
type Phase =
  | 'stowed'
  | 'dispensed'
  | 'open_slideout' // (a) slide fully clear of the slit on +Z, still folded
  | 'open_fly' // (b) translate to the viewer + orient to face the camera
  | 'open_unfold' // (c) hinge unfolds ~180deg, revealing the print
  | 'open_rest' // settled in front of the viewer; flip allowed here
  | 'closing'; // fold, then fly to the face thumbnail and shrink away

/** World up, for building the fixed app-camera look-at in scrub mode. */
const UP_VECTOR = new Vector3(0, 1, 0);

/**
 * The back-face message, clipped to the print rectangle and SCROLLABLE when it overflows.
 *
 * The text is `anchorY="top"`; at scroll offset 0 its first line sits at the window top.
 * To reveal lower lines we move the whole block UP by `offset` (its anchor rises above
 * the window) and shift the troika `clipRect` by the same `offset` so the clip WINDOW
 * stays fixed in the print frame — only the text slides under it. The visible offset is
 * eased toward `scrollState.target` (clamped to the measured overflow) every frame; the
 * overflow itself is measured once troika reports the text block bounds via `onSync`.
 *
 * Laid out in VIEWER-space extents (viewW × viewH) so the window matches the visible
 * print for both portrait and landscape; the parent group already counter-rotates so the
 * text reads upright when a landscape jacket is rolled.
 */
function ScrollableMessage({
  message,
  viewW,
  viewH,
  scrollState,
  active,
}: {
  message: string;
  viewW: number;
  viewH: number;
  /** Shared scroll state, or undefined in scrub/harness (then it renders static-top). */
  scrollState?: MessageScrollState;
  /** True only for the live open card (drives + publishes scroll). */
  active: boolean;
}) {
  const textRef = useRef<Group>(null);
  const { inset, wheelSpeed: _w, damp } = card.message;
  void _w; // wheelSpeed is applied by the interaction layer, not here.
  const windowW = viewW - 2 * inset;
  const windowH = viewH - 2 * inset;
  const topY = windowH / 2;

  // Measured overflow (block height − window height), the measured block height, and the
  // eased visible scroll offset.
  const overflowRef = useRef(0);
  const blockHeightRef = useRef(0);
  const visibleOffsetRef = useRef(0);

  useFrame((_, delta) => {
    const text = textRef.current;
    if (!text) return;
    const overflow = overflowRef.current;
    // A message that FITS is centred in the window (unchanged from the old look); one
    // that overflows is top-anchored and scrolls. `centerShift` is 0 when overflowing.
    const centerShift = overflow > 0 ? 0 : Math.max(0, (windowH - blockHeightRef.current) / 2);
    // Target: from shared state when active, else pinned to top.
    const rawTarget = active && scrollState ? scrollState.target : 0;
    const target = Math.min(overflow, Math.max(0, rawTarget));
    visibleOffsetRef.current = MathUtils.damp(visibleOffsetRef.current, target, damp, delta);
    const offset = visibleOffsetRef.current;
    // Move the block up by `offset` (scroll) and down by `centerShift` (centre when it
    // fits); shift the clip window by the same so it stays fixed in the print frame.
    const shift = offset - centerShift;
    text.position.y = topY + shift;
    // clipRect is in the text's LOCAL frame (anchor at its top = (0,0), glyphs below).
    // Window in that frame: Y ∈ [-windowH - shift, -shift], X ∈ [-windowW/2, windowW/2].
    const clip = text as unknown as { clipRect?: [number, number, number, number] };
    clip.clipRect = [-windowW / 2, -windowH - shift, windowW / 2, -shift];
  });

  return (
    <group>
      <Text
        ref={textRef as never}
        position={[0, topY, 0.0004]}
        fontSize={0.0056}
        font={LABEL_FONT}
        maxWidth={windowW}
        lineHeight={1.32}
        textAlign="center"
        anchorX="center"
        anchorY="top"
        color="#33312b"
        clipRect={[-windowW / 2, -windowH, windowW / 2, 0]}
        material-polygonOffset
        material-polygonOffsetFactor={-2}
        material-polygonOffsetUnits={-2}
        onSync={(troika: { textRenderInfo?: { blockBounds: number[] } }) => {
          const bounds = troika.textRenderInfo?.blockBounds;
          if (!bounds) return;
          const blockHeight = bounds[3] - bounds[1];
          blockHeightRef.current = blockHeight;
          const overflow = Math.max(0, blockHeight - windowH);
          overflowRef.current = overflow;
          if (active && scrollState) scrollState.max = overflow;
        }}
      >
        {message}
      </Text>
      <ScrollChevrons viewW={viewW} viewH={viewH} overflowRef={overflowRef} offsetRef={visibleOffsetRef} />
    </group>
  );
}

/**
 * Two faint handwritten chevrons (▲ top-right, ▼ bottom-right) shown only when the
 * message overflows, dimmed at the scroll clamps so they read as a quiet "more above /
 * below" cue. Driven by the same refs as the scroll so they need no React state.
 */
function ScrollChevrons({
  viewW,
  viewH,
  overflowRef,
  offsetRef,
}: {
  viewW: number;
  viewH: number;
  overflowRef: React.MutableRefObject<number>;
  offsetRef: React.MutableRefObject<number>;
}) {
  const upRef = useRef<Group>(null);
  const downRef = useRef<Group>(null);
  const size = card.message.chevronSize;
  const x = viewW / 2 - size;
  const y = viewH / 2 - size;

  useFrame(() => {
    const overflow = overflowRef.current;
    const offset = offsetRef.current;
    const up = upRef.current;
    const down = downRef.current;
    if (!up || !down) return;
    const hasOverflow = overflow > 1e-5;
    // Up cue visible when there's content scrolled above; down when content remains below.
    up.visible = hasOverflow && offset > 0.001;
    down.visible = hasOverflow && offset < overflow - 0.001;
  });

  return (
    <>
      <group ref={upRef} position={[x, y, 0.0006]} visible={false}>
        <Text fontSize={size} font={LABEL_FONT} anchorX="center" anchorY="middle" color="#9a958b">
          ▲
        </Text>
      </group>
      <group ref={downRef} position={[x, -y, 0.0006]} visible={false}>
        <Text fontSize={size} font={LABEL_FONT} anchorX="center" anchorY="middle" color="#9a958b">
          ▼
        </Text>
      </group>
    </>
  );
}

/**
 * A KRAFT FOLDING JACKET holding a separate PRINT INSERT (ref-04/06 + the user's
 * fold-open intent):
 *
 *   - The JACKET is two kraft panels sharing a horizontal spine, white outside /
 *     kraft inside. It pops out FOLDED (lid folded cover-to-cover onto the base),
 *     lying FLAT and sliding forward through the slit above the coin slots.
 *   - The PRINT INSERT is a separate stiff card mounted on the BASE panel. Its
 *     FRONT face = artwork + handwritten title + "A1"; its BACK face = the message.
 *
 * Behaviour (driven by an ordered phase timeline in useFrame):
 *   - 'dispensed': folded jacket lies flat, slid out only ~25% through the slit
 *     (mostly inside, fully white because the print is hidden in the fold).
 *   - 'open': (a) slides fully clear, (b) flies to the camera + turns to face it,
 *     (c) unfolds to reveal the print insert. Adapts to portrait/landscape.
 *   - flip: rotates ONLY the print insert 180° about Y (art ↔ back message),
 *     coming FORWARD first so it never clips the lid. The jacket never flips.
 *
 * Portrait/landscape via CelebrationPrint.orientation (swaps the print W/H; a fit
 * scale keeps the insert inside the fixed-size kraft panel).
 *
 * Local frame: +Z toward viewer, +Y up. Root lives in the Drawer-local frame
 * (origin at the handle centre). Contract: { print, state, flipped, onTake }.
 */
export function FoldedCardPart({
  print: item,
  state,
  flipped,
  onTake,
  onClosed,
  scrubT,
  flipScrubT,
  appCameraWorld,
  stowTargetWorld,
  scrollState,
}: {
  print: CelebrationPrint;
  state: CardState;
  flipped: boolean;
  /** Shared back-message scroll state (target offset + measured overflow). Written by
   *  the open card after it measures the message; the target is driven by the card
   *  interaction layer's wheel/drag. Optional: the harness/dispense scrub omit it. */
  scrollState?: MessageScrollState;
  /** Click the protruding folded card while dispensed to take it. */
  onTake?: () => void;
  /**
   * Fires ONCE when the CLOSE animation completes (the card has folded, flown back to its
   * thumbnail and shrunk away). The app uses this to unmount the open card only after the
   * fly-home finishes, so the card stays bound to its print for the whole close. Harness
   * never sets this.
   */
  onClosed?: () => void;
  /**
   * HARNESS-ONLY. When set (0..1), bypasses the live time/state machine and poses the
   * card DETERMINISTICALLY at that normalized progress along the WHOLE sequence
   * (dispense → rest → slideout → fly → unfold → rest → close). The real app
   * (MachineScene/Drawer) never passes this, so runtime behaviour is unchanged. Used
   * by the contact-sheet tool to render reproducible keyframes.
   */
  scrubT?: number;
  /**
   * HARNESS-ONLY. When set (0..1), holds the OPEN-REST pose and drives the print-insert
   * FLIP deterministically (forward-lift → spin 180° → settle), so the contact-sheet
   * tool can verify the insert clears the kraft mid-turn. Ignored unless scrubT is also
   * set. The real app never passes it.
   */
  flipScrubT?: number;
  /**
   * HARNESS-ONLY. Fixed virtual app-camera (world pos + look-at target) used to
   * compute the fly/unfold "face the viewer" pose during scrub, so an external
   * observer camera can watch the real trajectory from any angle. Defaults to the
   * real app camera.
   */
  appCameraWorld?: { pos: [number, number, number]; target: [number, number, number] };
  /**
   * WORLD position of this print's thumbnail on the machine face. On CLOSE the taken
   * card folds, then flies to its own thumbnail and shrinks away (so it visibly "returns"
   * to its slot on the grid). Derived once from `thumbWorldPosition` (the SoT). Optional:
   * without it the card falls back to receding to the generic stowed pose.
   */
  stowTargetWorld?: [number, number, number];
}) {
  const rootRef = useRef<Group>(null);
  const hingeRef = useRef<Group>(null);
  const flipRef = useRef<Group>(null);
  const { camera } = useThree();
  const { texture: photo, orientation: detectedOrientation, aspect: photoAspect } =
    usePhotoTexture(item.photo);

  const panelWidth = card.panelWidth;
  const panelHeight = card.panelHeight;
  const thickness = card.thickness;
  const spineHeight = card.spineHeight;

  // EVERY print is mounted into the jacket the SAME way (portrait): the insert is
  // never rotated. A landscape print is shown by yawing the WHOLE jacket 90° once it
  // is open at the camera (see `landscape` + `landscapeOpenYaw` below), not by
  // turning the insert. So the insert dimensions are always the portrait ones.
  //
  // Orientation is auto-detected from the loaded image (detectedOrientation), with the
  // catalogue's explicit `orientation` as an override and portrait as the pre-load
  // default. detectedOrientation arrives with the photo texture, so the jacket settles
  // to its true shape at the same moment the art appears — no mid-animation pop.
  const landscape = (item.orientation ?? detectedOrientation ?? 'portrait') === 'landscape';
  const printW = print.width;
  const printH = print.height;

  // VIEWER-space print extents: how big the print reads to the eye AFTER the jacket
  // roll. The insert is always physically portrait (printW×printH), but a landscape
  // jacket rolls 90°, so the print appears WIDE (its width/height swap). Captions are
  // laid out in this viewer frame and then counter-rotated onto the insert, so the
  // title/mark always sit at the visible bottom edge and stay upright (matching the
  // reference: title bottom-left, one small studio mark bottom-right).
  const viewW = landscape ? printH : printW;
  const viewH = landscape ? printW : printH;

  // PHOTO PLANE: shown at the image's TRUE aspect, CONTAINED within the print's art area
  // so it is never stretched (the old plane was a fixed viewW×viewH rectangle, which
  // squished every photo to the print's shape). The art area is the same box the old code
  // used (viewW*0.9 × viewH*0.72) — leaving the caption row at the bottom and a paper
  // margin — and the photo fits inside it centred, with kraft showing on the off-axis.
  //
  // `photoAspect` (naturalW/naturalH) is expressed in VIEWER space already: the geometry
  // below is authored in viewer space (then counter-rolled for landscape), and viewW/viewH
  // are pre-swapped for landscape, so a wide image's wide aspect maps straight through.
  // Pre-load we fall back to the box's own aspect so the plane doesn't pop when the photo
  // arrives (mirrors the detectedOrientation pre-load default).
  const artBoxWidth = viewW * 0.9;
  const artBoxHeight = viewH * 0.72;
  const effectiveAspect = photoAspect ?? artBoxWidth / artBoxHeight;
  const boxAspect = artBoxWidth / artBoxHeight;
  const photoPlaneWidth = effectiveAspect > boxAspect ? artBoxWidth : artBoxHeight * effectiveAspect;
  const photoPlaneHeight = effectiveAspect > boxAspect ? artBoxWidth / effectiveAspect : artBoxHeight;

  // The kraft panels stay one fixed size for every card; the insert is uniformly
  // scaled DOWN to fit inside with a small inset margin.
  const insetMargin = 0.006;
  const fit = Math.min(1, (panelWidth - insetMargin) / printW, (panelHeight - insetMargin) / printH);

  const { kraftMap, kraftBump } = useMemo(() => createKraftTextures(card.boardColor), []);

  // Animation state — refs only (never React state; this runs every frame).
  const phaseRef = useRef<Phase>('stowed');
  const tRef = useRef(0);
  const prevStateRef = useRef<CardState>('stowed');
  const prevFlippedRef = useRef(false);
  /** Flip is a MONOTONIC PROGRESS animation (0→1), NOT an edge-triggered state machine
   *  (which jump-cut on the reverse). On each toggle, `flipProgressRef` resets to 0 and
   *  climbs to 1; the pose helper `applyFlipPose` maps progress→(lift, spin) using the
   *  current `flipped` as the destination face, so the insert always lifts clear, spins,
   *  and settles — identical for the live path and the harness scrub. */
  const flipProgressRef = useRef(1);
  /** One-shot guard so onClosed fires exactly once per close (reset when a new close
   *  begins). Prevents re-firing every frame once the closing phase reaches 'stowed'. */
  const closeReportedRef = useRef(false);
  /** The packet's z when the take-the-card slide (`open_slideout`) begins, captured once
   *  on phase entry so the slide is a FIXED-DURATION interpolation from there to
   *  `slideOutZ` (matched to the card-take SFX), not a damp-to-target that converges
   *  early and desyncs from the sound. */
  const slideStartZRef = useRef(0);

  // Scratch vectors/quaternions (reused each frame to avoid per-frame allocation).
  const targetPos = useMemo(() => new Vector3(), []);
  const slidePos = useMemo(() => new Vector3(), []);
  const stowPos = useMemo(() => new Vector3(), []);
  const forward = useMemo(() => new Vector3(), []);
  const parentQuat = useMemo(() => new Quaternion(), []);
  const viewQuat = useMemo(() => new Quaternion(), []);
  // Dispensed: the folded card lies FLAT and DEAD LEVEL, face up, and only slides
  // forward (no rotation while sliding). Rotating -90° about X lays the upright card
  // down so its base extends toward the viewer (+Z) and the print normal points up
  // (+Y). dispensedTilt is 0 (ref-01 shows it dead level).
  const flatQuat = useMemo(
    () => new Quaternion().setFromEuler(new Euler(-Math.PI / 2 + card.dispensedTilt, 0, 0)),
    [],
  );
  // Extra 90° ROLL (about the card's local +Z, the view axis) composed onto the
  // face-camera quaternion for LANDSCAPE prints when open, so the whole jacket reads
  // horizontally (cover rolls from the top to the LEFT) while still facing the eye.
  const landscapeRollQuat = useMemo(
    () => new Quaternion().setFromEuler(new Euler(0, 0, card.landscapeOpenRoll)),
    [],
  );
  // Scratch for the scrub-mode fixed-app-camera viewer target.
  const appCamPos = useMemo(() => new Vector3(), []);
  const appCamLook = useMemo(() => new Vector3(), []);
  const appCamQuat = useMemo(() => new Quaternion(), []);
  const lookMatrix = useMemo(() => new Matrix4(), []);

  /** Snap the jacket to the fully-out folded pose (no lerp). Used when reopening
   *  an already-owned print from the face grid: it was never dispensed, so it must
   *  NOT replay the slit slide from behind the face. */
  const seedFullyOutPose = (root: Group, hinge: Group, flip: Group) => {
    root.position.set(0, card.dispensedY, card.slideOutZ);
    root.quaternion.copy(flatQuat);
    root.scale.setScalar(1); // undo any shrink left over from a prior close
    hinge.rotation.x = -Math.PI;
    flip.rotation.y = 0;
    flip.position.z = 0.001;
  };

  /** Snap the jacket to its FLAT, FOLDED, still-inside pose (no lerp) so the dispense
   *  is a pure translation out the slit — it is born already-flat and never rotates
   *  while sliding (the old bug). Held at `hiddenZ` until the handle is most of the
   *  way out, then translated to `dispensedZ`. */
  const seedHiddenFlatPose = (root: Group, hinge: Group, flip: Group) => {
    root.position.set(0, card.dispensedY, card.hiddenZ);
    root.quaternion.copy(flatQuat);
    root.scale.setScalar(1); // undo any shrink left over from a prior close
    hinge.rotation.x = -Math.PI;
    flip.rotation.y = 0;
    flip.position.z = 0.001;
  };

  /** Compute the viewer-facing target pose (drawer-local) into targetPos/viewQuat.
   *  Aligning the card's local axes with the camera's puts its +Z face (where the
   *  print art lives) toward the viewer: the camera looks down its own local -Z, so
   *  its +Z points back at the eye, and so does the matched card +Z. For a LANDSCAPE
   *  print we right-multiply an extra 90-degree ROLL (about the view axis) so the
   *  jacket reads horizontally (cover rolls to the left), still facing the eye. */
  const updateViewerTarget = (root: Group) => {
    camera.getWorldDirection(forward);
    targetPos.copy(camera.position).addScaledVector(forward, card.viewerDistance);
    if (root.parent) root.parent.worldToLocal(targetPos);
    if (root.parent) {
      root.parent.getWorldQuaternion(parentQuat).invert();
      viewQuat.copy(parentQuat).multiply(camera.quaternion);
    } else {
      viewQuat.copy(camera.quaternion);
    }
    if (landscape) viewQuat.multiply(landscapeRollQuat);
  };

  /** Like updateViewerTarget but against a FIXED virtual app-camera (scrub mode), so a
   *  separate observer camera can watch the trajectory from any angle. Writes
   *  targetPos/viewQuat. */
  const updateViewerTargetFromAppCamera = (root: Group) => {
    const cam = appCameraWorld ?? {
      pos: [0, 0.02, 1.05] as [number, number, number],
      target: [0, lowerPanel.centerY + 0.1, cabinet.faceZ] as [number, number, number],
    };
    appCamPos.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    appCamLook.set(cam.target[0], cam.target[1], cam.target[2]);
    // Build the app-camera world quaternion from a look-at (camera looks down -Z).
    lookMatrix.lookAt(appCamPos, appCamLook, UP_VECTOR);
    appCamQuat.setFromRotationMatrix(lookMatrix);
    forward.copy(appCamLook).sub(appCamPos).normalize();
    targetPos.copy(appCamPos).addScaledVector(forward, card.viewerDistance);
    if (root.parent) root.parent.worldToLocal(targetPos);
    if (root.parent) {
      root.parent.getWorldQuaternion(parentQuat).invert();
      viewQuat.copy(parentQuat).multiply(appCamQuat);
    } else {
      viewQuat.copy(appCamQuat);
    }
    if (landscape) viewQuat.multiply(landscapeRollQuat);
  };

  /**
   * Pose the print insert at flip PROGRESS p∈[0,1]. The insert lifts FORWARD (so it
   * clears the kraft), spins 180° about Y, then settles back. `toBack` picks the END
   * face (true = settle showing the BACK message at y=π; false = settle showing the
   * FRONT art at y=0). Progress always runs 0→1; the spin segment maps to the correct
   * start→end angle for the chosen direction, so reversing is just another 0→1 run with
   * the opposite `toBack`. Lift: up by the middle, down by the end (forward 0–0.33, hold
   * across the spin, return 0.66–1.0). Shared by the live path and the harness scrub so
   * they can never diverge (the source of the old reverse jump-cut).
   */
  const applyFlipPose = (flip: Group, p: number, toBack: boolean) => {
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    const progress = clamp01(p);
    const lift = clamp01(Math.min(progress, 1 - progress) / 0.33);
    flip.position.z = MathUtils.lerp(0.001, card.flipForwardZ, lift);
    const spin = clamp01((progress - 0.33) / 0.33);
    const startY = toBack ? 0 : Math.PI;
    const endY = toBack ? Math.PI : 0;
    flip.rotation.y = MathUtils.lerp(startY, endY, spin);
  };

  /**
   * DETERMINISTIC pose at normalized progress t∈[0,1] over the whole sequence (scrub
   * mode; harness-only). Mirrors the live phases' targets but driven by t (no time /
   * no damp), so the contact-sheet tool gets reproducible keyframes. Segment table
   * matches the plan: dispense / rest / slideout / fly / unfold / rest / close.
   */
  const poseAtT = (t: number, root: Group, hinge: Group, flip: Group) => {
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    const seg = (lo: number, hi: number) => clamp01((t - lo) / (hi - lo));
    // Print-insert flip pose. Default at rest (front); when flipScrubT is set, drive the
    // deterministic forward-lift → spin → settle arc (front→back) so the contact sheet
    // can confirm the insert clears the kraft mid-turn.
    if (flipScrubT == null) {
      flip.rotation.y = 0;
      flip.position.z = 0.001;
    } else {
      applyFlipPose(flip, flipScrubT, true);
    }

    if (t < 0.24) {
      // dispense slide (0–0.14) then rest dispensed (0.14–0.24): flat, folded, level.
      const s = seg(0, 0.14);
      root.quaternion.copy(flatQuat);
      hinge.rotation.x = -Math.PI;
      root.position.set(0, card.dispensedY, MathUtils.lerp(card.hiddenZ, card.dispensedZ, s));
      return;
    }
    if (t < 0.4) {
      // slideout: push z dispensedZ→slideOutZ, still flat + folded.
      const s = seg(0.24, 0.4);
      root.quaternion.copy(flatQuat);
      hinge.rotation.x = -Math.PI;
      root.position.set(0, card.dispensedY, MathUtils.lerp(card.dispensedZ, card.slideOutZ, s));
      return;
    }
    // From here on, fly/unfold/rest/close all reference the viewer target.
    updateViewerTargetFromAppCamera(root);
    if (t < 0.6) {
      // fly: from the fully-out flat pose to the viewer pose, still folded.
      const s = seg(0.4, 0.6);
      slidePos.set(0, card.dispensedY, card.slideOutZ);
      root.position.copy(slidePos).lerp(targetPos, s);
      root.quaternion.copy(flatQuat).slerp(viewQuat, s);
      hinge.rotation.x = -Math.PI;
      return;
    }
    if (t < 0.8) {
      // unfold: hold at viewer, swing the lid from folded (-π) to open.
      const s = seg(0.6, 0.8);
      root.position.copy(targetPos);
      root.quaternion.copy(viewQuat);
      hinge.rotation.x = MathUtils.lerp(-Math.PI, card.openHingeAngle, s);
      return;
    }
    if (t < 0.9) {
      // rest open.
      root.position.copy(targetPos);
      root.quaternion.copy(viewQuat);
      hinge.rotation.x = card.openHingeAngle;
      return;
    }
    // close: fold the lid shut (0.9–0.95) then retreat to stowed (0.95–1.0).
    const fold = seg(0.9, 0.95);
    const retreat = seg(0.95, 1.0);
    hinge.rotation.x = MathUtils.lerp(card.openHingeAngle, -Math.PI, fold);
    slidePos.set(0, card.stowedY, card.stowedZ);
    root.position.copy(targetPos).lerp(slidePos, retreat);
    root.quaternion.copy(viewQuat).slerp(flatQuat, retreat);
  };

  useFrame((_, delta) => {
    const root = rootRef.current;
    const hinge = hingeRef.current;
    const flip = flipRef.current;
    if (!root || !hinge || !flip) return;

    // HARNESS scrub: deterministic pose at an explicit progress, no time/damp.
    if (scrubT != null) {
      root.visible = true;
      poseAtT(scrubT, root, hinge, flip);
      return;
    }

    // React to a state transition: choose the phase + entry pose.
    if (state !== prevStateRef.current) {
      if (state === 'open') {
        // The print always opens un-flipped (App resets flipped on each open); seed the
        // flip at rest (progress done, showing the front) so opening doesn't replay a turn.
        flipProgressRef.current = 1;
        prevFlippedRef.current = flipped;
        // Reset the back-message scroll so a freshly opened card starts at the top.
        if (scrollState) {
          scrollState.target = 0;
          scrollState.max = 0;
        }
        if (prevStateRef.current === 'dispensed') {
          // Took the dispensed card: run the full chain from the slit. Capture the
          // current z so the slide is a fixed-duration interpolation from where the
          // packet was sitting (its dispensed-out position) to slideOutZ.
          slideStartZRef.current = root.position.z;
          phaseRef.current = 'open_slideout';
        } else {
          // Reopened an owned print (never dispensed): jump straight to the fly,
          // seeded at the fully-out folded pose so it doesn't pass through the face.
          seedFullyOutPose(root, hinge, flip);
          phaseRef.current = 'open_fly';
        }
      } else if (state === 'dispensed') {
        // Born flat + folded + still inside, so the dispense is a pure +Z slide out
        // the slit (no rotation while moving). Only seed when arriving from a hidden
        // state; if it was already dispensed we keep its current pose.
        if (prevStateRef.current !== 'dispensed') seedHiddenFlatPose(root, hinge, flip);
        phaseRef.current = 'dispensed';
      } else {
        // Going to stowed from a visible state: fold + retreat first.
        phaseRef.current = prevStateRef.current === 'stowed' ? 'stowed' : 'closing';
        flipProgressRef.current = 1;
        closeReportedRef.current = false; // arm the onClosed one-shot for this close
      }
      tRef.current = 0;
      prevStateRef.current = state;
    }

    const shouldShow = state !== 'stowed' || phaseRef.current === 'closing';
    root.visible = shouldShow;
    if (!shouldShow) return;

    tRef.current += delta;
    const phase = phaseRef.current;
    const dampTo = (current: number, target: number, lambda: number) =>
      MathUtils.damp(current, target, lambda, delta);
    const alpha = (lambda: number) => 1 - Math.exp(-lambda * delta);

    switch (phase) {
      case 'dispensed': {
        // Pure TRANSLATION out the slit — the packet is already flat + folded (seeded
        // on entry), so it never rotates while sliding. It WAITS inside (hiddenZ)
        // until the handle is most of the way out (emergeGate of the budget), then
        // pushes out to dispensedZ — reading as "the handle pushes the print out".
        const emerging = tRef.current >= card.durSlideout * card.emergeGate;
        const targetZ = emerging ? card.dispensedZ : card.hiddenZ;
        slidePos.set(0, card.dispensedY, targetZ);
        root.position.lerp(slidePos, alpha(card.dampSlide));
        // Hold the flat orientation + folded lid; no slerp (already there).
        root.quaternion.copy(flatQuat);
        hinge.rotation.x = -Math.PI;
        flip.rotation.y = 0;
        flip.position.z = 0.001;
        break;
      }
      case 'open_slideout': {
        // (a) Push only +Z clear of the slit, flat + folded (no rotation). FIXED
        // DURATION (not damp-to-target): the packet slides from where it sat
        // (slideStartZRef) to slideOutZ over exactly card.durSlideout, so the motion
        // tracks the card-take SFX — the slide is visible across the slide sound and the
        // packet seats at full extension as the metallic clack rings. An ease-out
        // (1-(1-p)^2) gives a crisp settle. Advance ONLY at p>=1 (no epsilon escape) so
        // the fly always begins right when the sound ends.
        const slideP = Math.min(1, Math.max(0, tRef.current / card.durSlideout));
        const slideEase = 1 - (1 - slideP) * (1 - slideP);
        root.position.set(
          0,
          card.dispensedY,
          MathUtils.lerp(slideStartZRef.current, card.slideOutZ, slideEase),
        );
        root.quaternion.copy(flatQuat);
        hinge.rotation.x = -Math.PI;
        if (slideP >= 1) {
          phaseRef.current = 'open_fly';
          tRef.current = 0;
        }
        break;
      }
      case 'open_fly': {
        // (b) Travel to the viewer and turn to face the camera (still folded).
        updateViewerTarget(root);
        root.position.lerp(targetPos, alpha(card.dampFly));
        root.quaternion.slerp(viewQuat, alpha(card.dampFly));
        hinge.rotation.x = dampTo(hinge.rotation.x, -Math.PI, card.dampFly);
        const posClose = root.position.distanceTo(targetPos) < card.epsPos;
        const angleClose = root.quaternion.angleTo(viewQuat) < card.epsAngle;
        if ((posClose && angleClose) || tRef.current >= card.durFly) {
          phaseRef.current = 'open_unfold';
          tRef.current = 0;
        }
        break;
      }
      case 'open_unfold': {
        // (c) Hold at the viewer and swing the lid open ~180°.
        updateViewerTarget(root);
        root.position.lerp(targetPos, alpha(card.dampUnfold));
        root.quaternion.slerp(viewQuat, alpha(card.dampUnfold));
        hinge.rotation.x = dampTo(hinge.rotation.x, card.openHingeAngle, card.dampUnfold);
        runFlip(flip, flipped, delta);
        if (
          Math.abs(hinge.rotation.x - card.openHingeAngle) < card.epsAngle ||
          tRef.current >= card.durUnfold
        ) {
          phaseRef.current = 'open_rest';
          tRef.current = 0;
        }
        break;
      }
      case 'open_rest': {
        updateViewerTarget(root);
        root.position.lerp(targetPos, alpha(card.dampUnfold));
        root.quaternion.slerp(viewQuat, alpha(card.dampUnfold));
        hinge.rotation.x = dampTo(hinge.rotation.x, card.openHingeAngle, card.dampUnfold);
        runFlip(flip, flipped, delta);
        break;
      }
      case 'closing': {
        // Fold the lid shut first (holding position so the open card doesn't drag
        // through the machine), then FLY to this print's own face thumbnail and SHRINK
        // away — it visibly "returns" to its slot on the grid. Force the insert
        // un-flipped (front) so it isn't caught mid-spin.
        flipProgressRef.current = 1;
        prevFlippedRef.current = false;
        applyFlipPose(flip, 1, false);
        hinge.rotation.x = dampTo(hinge.rotation.x, -Math.PI, card.dampClose);
        const folded = Math.abs(hinge.rotation.x - -Math.PI) < card.epsAngle;
        if (folded || tRef.current >= card.durClose * 0.4) {
          // Target: the thumbnail world position, converted into the parent-local frame
          // (fallback to the generic stowed pose if no thumbnail was supplied).
          if (stowTargetWorld) {
            stowPos.set(stowTargetWorld[0], stowTargetWorld[1], stowTargetWorld[2]);
            if (root.parent) root.parent.worldToLocal(stowPos);
          } else {
            stowPos.set(0, card.stowedY, card.stowedZ);
          }
          root.position.lerp(stowPos, alpha(card.dampClose));
          root.quaternion.slerp(viewQuat, alpha(card.dampClose)); // stay facing the wall/eye
          // Shrink away as it nears the thumbnail.
          const remaining = root.position.distanceTo(stowPos);
          const shrinkSpan = 0.12; // start shrinking within 12cm of the thumbnail
          const targetScale = Math.max(0.001, Math.min(1, remaining / shrinkSpan));
          root.scale.setScalar(MathUtils.damp(root.scale.x, targetScale, card.dampClose * 1.5, delta));
        }
        if (root.position.distanceTo(stowPos) < card.epsPos || root.scale.x < 0.02) {
          phaseRef.current = 'stowed';
          if (!closeReportedRef.current) {
            closeReportedRef.current = true;
            onClosed?.(); // tell the app the card has flown home; safe to unmount
          }
        }
        break;
      }
      case 'stowed':
      default:
        break;
    }
  });

  /**
   * Flip the print insert: lift FORWARD (clear of the kraft), SPIN 180° about Y, settle.
   * Driven by a MONOTONIC progress timer, not an edge state machine — every `flipped`
   * toggle resets progress to 0 and records the direction, then progress climbs 0→1 and
   * `applyFlipPose` renders it. This makes the REVERSE flip animate identically to the
   * forward one (the old edge machine snapped on reverse). `flipDuration` is the seconds
   * for a full turn.
   */
  function runFlip(flip: Group, flippedNow: boolean, delta: number) {
    if (flippedNow !== prevFlippedRef.current) {
      prevFlippedRef.current = flippedNow;
      flipProgressRef.current = 0; // restart the turn
      // Reset scroll when turning back to FRONT, so the next flip-to-back starts at top.
      if (!flippedNow && scrollState) scrollState.target = 0;
    }
    if (flipProgressRef.current < 1) {
      flipProgressRef.current = Math.min(1, flipProgressRef.current + delta / card.flipDuration);
    }
    // toBack = settle showing the BACK message. When flippedNow is true we are turning TO
    // the back; when false we are turning back TO the front.
    applyFlipPose(flip, flipProgressRef.current, flippedNow);
  }

  // Jacket board: WHITE outside, KRAFT inside. BoxGeometry face order
  // [+X,-X,+Y,-Y,+Z,-Z]; the inside face (+Z) is kraft, the rest white.
  const boardMaterials = (
    <>
      <meshStandardMaterial attach="material-0" color={card.whiteColor} roughness={0.9} />
      <meshStandardMaterial attach="material-1" color={card.whiteColor} roughness={0.9} />
      <meshStandardMaterial attach="material-2" color={card.whiteColor} roughness={0.9} />
      <meshStandardMaterial attach="material-3" color={card.whiteColor} roughness={0.9} />
      <meshStandardMaterial
        attach="material-4"
        map={kraftMap}
        bumpMap={kraftBump}
        bumpScale={0.12}
        roughness={0.92}
      />
      <meshStandardMaterial attach="material-5" color={card.whiteColor} roughness={0.9} />
    </>
  );
  const kraftMaterial = (
    <meshStandardMaterial map={kraftMap} bumpMap={kraftBump} bumpScale={0.12} roughness={0.92} />
  );

  // A jacket panel (board slab, white out / kraft in). `children` ride just proud
  // of the inner (+Z) face.
  const Panel = ({ centerY, children }: { centerY: number; children?: React.ReactNode }) => (
    <group position={[0, centerY, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[panelWidth, panelHeight, thickness]} />
        {boardMaterials}
      </mesh>
      <group position={[0, 0, thickness / 2 + 0.0006]}>{children}</group>
    </group>
  );

  return (
    <group ref={rootRef} visible={false} position={[0, card.stowedY, card.stowedZ]}>
      {/* Spine bridging both panels at the crease (y = 0). */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[panelWidth, spineHeight, thickness * 1.15]} />
        {kraftMaterial}
      </mesh>

      {/* BASE panel: hangs below the spine. Carries the PRINT INSERT (flippable). */}
      <Panel centerY={-(panelHeight / 2 + spineHeight / 2)}>
        {/* TAKE hit area: an invisible FAT BOX over the PROTRUDING HEAD of the packet,
            so clicking the visible card tip takes it. When dispensed the jacket lies flat
            (flatQuat): local −Y → world +Z (the head pokes toward the camera) and local
            +Z → world +Y (up). The coin-slot hit box sits just behind/below the slit and
            was stealing these clicks, so this box is BOTH (1) shifted toward the head
            (−Y, i.e. forward/out the slit) and (2) made tall on local Z (world +Y, ≈4cm)
            so it stands clearly PROUD of and IN FRONT OF the coin box — the raycaster
            then hits the card first. Mounted only while dispensed; stopPropagation. */}
        {state === 'dispensed' && onTake ? (
          <mesh
            position={[0, -panelHeight * 0.7, 0.02]}
            onClick={(event) => {
              event.stopPropagation();
              onTake();
            }}
          >
            <boxGeometry args={[panelWidth + 0.01, panelHeight * 1.1, 0.05]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        ) : null}
        <group
          ref={flipRef}
          position={[0, 0, 0.001]}
          scale={fit}
        >
          {/* Print stock body. */}
          <mesh castShadow>
            <boxGeometry args={[printW, printH, print.thickness]} />
            <meshStandardMaterial color="#ffffff" roughness={0.95} />
          </mesh>
          {/* FRONT (+Z): art (rolls with the jacket for landscape) + caption. The art
              plane fills the print INSIDE a paper margin (sized to the VIEWER-space
              rectangle so it reads correctly wide for landscape). The CAPTION group is
              counter-rotated for landscape so the handwriting stays UPRIGHT; it is laid
              out in viewer-space (viewW×viewH) so the title sits at the visible
              bottom-LEFT and the single "FOUR QTRS" studio mark at the bottom-RIGHT, both
              ON the print (matching the reference — no duplicate A1 mark). */}
          <group position={[0, 0, print.thickness / 2 + 0.0005]}>
            <mesh position={[0, 0, 0]} rotation={[0, 0, landscape ? -card.landscapeOpenRoll : 0]}>
              <planeGeometry args={[photoPlaneWidth, photoPlaneHeight]} />
              <meshBasicMaterial map={photo ?? undefined} color="#ffffff" toneMapped={false} />
            </mesh>
            <group rotation={[0, 0, landscape ? -card.landscapeOpenRoll : 0]}>
              <Text
                position={[-viewW / 2 + 0.006, -viewH / 2 + 0.008, 0.0004]}
                fontSize={0.0062}
                font={LABEL_FONT}
                maxWidth={viewW * 0.66}
                textAlign="left"
                anchorX="left"
                anchorY="middle"
                color="#2c2a26"
                material-polygonOffset
                material-polygonOffsetFactor={-2}
                material-polygonOffsetUnits={-2}
              >
                {item.title}
              </Text>
              {/* Single "FOUR QTRS" studio mark, stacked, bottom-right. */}
              <Text
                position={[viewW / 2 - 0.009, -viewH / 2 + 0.009, 0.0004]}
                fontSize={0.0034}
                font={LABEL_FONT}
                lineHeight={1.05}
                textAlign="center"
                anchorX="center"
                anchorY="middle"
                color="#6a655c"
                material-polygonOffset
                material-polygonOffsetFactor={-2}
                material-polygonOffsetUnits={-2}
              >
                {'FOUR\nQTRS'}
              </Text>
            </group>
          </group>
          {/* BACK (-Z): the message. Rotated π about Y so it reads after the flip; the
              inner text group is counter-rotated for landscape so the message reads
              HORIZONTALLY and UPRIGHT when the jacket is rolled, with maxWidth in
              viewer-space width so it wraps within the visible print. The π-about-Y flip
              mirrors the local X axis, so the counter-roll that lands upright is
              −landscapeOpenRoll (same sign as the front caption). */}
          <group position={[0, 0, -(print.thickness / 2 + 0.0005)]} rotation={[0, Math.PI, 0]}>
            <mesh>
              <planeGeometry args={[printW, printH]} />
              <meshStandardMaterial color="#fffdf8" roughness={0.97} />
            </mesh>
            <group rotation={[0, 0, landscape ? -card.landscapeOpenRoll : 0]}>
              <ScrollableMessage
                message={item.message}
                viewW={viewW}
                viewH={viewH}
                scrollState={scrollState}
                // Live open card drives + publishes scroll; the harness/dispense scrub
                // (scrubT set) renders the message pinned to the top, no scroll input.
                active={scrubT == null && state === 'open'}
              />
            </group>
          </group>
        </group>
      </Panel>

      {/* LID panel: hinged at the spine. rotation.x = 0 => open/flat above the
          spine; -PI => folded cover-to-cover onto the base (closed). The hinge is
          lifted (lidHingeZ) so the folded lid clears the print insert and hides it
          (white packet, no artwork showing) when dispensed. Blank kraft interior —
          the only printed surface is the insert on the base. */}
      <group ref={hingeRef} position={[0, 0, card.lidHingeZ]} rotation={[-Math.PI, 0, 0]}>
        <Panel centerY={panelHeight / 2 + spineHeight / 2} />
      </group>
    </group>
  );
}

/**
 * Builds a kraft-cardboard colour map plus a matching bump map: warm base, soft
 * pulp mottling, fine fibre speckle (mirrored into the bump map).
 */
function createKraftTextures(baseColor: string) {
  const size = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = size;
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = bumpCanvas.height = size;
  const colorCtx = colorCanvas.getContext('2d');
  const bumpCtx = bumpCanvas.getContext('2d');

  const fallback = () => {
    const map = new CanvasTexture(colorCanvas);
    map.colorSpace = SRGBColorSpace;
    const bump = new CanvasTexture(bumpCanvas);
    return { kraftMap: map, kraftBump: bump };
  };
  if (!colorCtx || !bumpCtx) return fallback();

  colorCtx.fillStyle = baseColor;
  colorCtx.fillRect(0, 0, size, size);
  bumpCtx.fillStyle = '#808080';
  bumpCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 18 + Math.random() * 46;
    const warm = Math.random() > 0.5;
    const alpha = 0.05 + Math.random() * 0.07;
    const gradient = colorCtx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, warm ? `rgba(120, 92, 54, ${alpha})` : `rgba(232, 224, 205, ${alpha})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    colorCtx.fillStyle = gradient;
    colorCtx.beginPath();
    colorCtx.arc(x, y, radius, 0, Math.PI * 2);
    colorCtx.fill();
  }

  const speckleCount = size * size * 0.18;
  for (let i = 0; i < speckleCount; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const d = (Math.random() - 0.5) * 2;
    const colorAlpha = 0.04 + Math.random() * 0.08;
    colorCtx.fillStyle = d < 0 ? `rgba(70, 52, 28, ${colorAlpha})` : `rgba(255, 248, 230, ${colorAlpha})`;
    colorCtx.fillRect(x, y, 1, 1);
    const bumpShade = 128 + d * (40 + Math.random() * 40);
    bumpCtx.fillStyle = `rgb(${bumpShade | 0}, ${bumpShade | 0}, ${bumpShade | 0})`;
    bumpCtx.fillRect(x, y, 1, 1);
  }

  const kraftMap = new CanvasTexture(colorCanvas);
  kraftMap.colorSpace = SRGBColorSpace;
  kraftMap.wrapS = kraftMap.wrapT = RepeatWrapping;
  kraftMap.anisotropy = 4;

  const kraftBump = new CanvasTexture(bumpCanvas);
  kraftBump.wrapS = kraftBump.wrapT = RepeatWrapping;

  return { kraftMap, kraftBump };
}
