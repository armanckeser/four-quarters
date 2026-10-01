import { ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { Text } from './SceneText';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Vector3 } from 'three';
import { CelebrationPrint, SlotId, slotOrder } from '../data/celebration';
import { usePrints } from '../deck/DeckProvider';
import { COINS_REQUIRED } from '../App';
import type { MachineState, OpenCard } from '../App';
import { usePrintTextures } from '../lib/textures';
import { quality } from '../lib/quality';
import { CabinetBody } from './machine/CabinetBody';
import { Handle } from './machine/Handle';
import { FoldedCardPart } from './machine/FoldedCardPart';
import type { MessageScrollState } from './machine/FoldedCardPart';
import { LibraryEnvironment } from './machine/LibraryEnvironment';
import { BookstoreBackdrop } from './machine/BookstoreBackdrop';
import {
  DISPLAY_FONT,
  LABEL_FONT,
  PAGE_SIZE,
  cabinet,
  card,
  faceLayout,
  floor,
  gridLayout,
  handle,
  lowerPanel,
  pageCount,
  pageOfIndex,
  print,
  slotX,
  thumbSlotOnPage,
  thumbWorldPosition,
} from '../lib/dimensions';

type MachineSceneProps = {
  machine: MachineState;
  collected: Set<string>;
  openCard: OpenCard | null;
  openPrint: CelebrationPrint | null;
  /** 0-based page of the face thumbnail grid currently showing. */
  gridPage: number;
  onAdvanceDrawer: (slotId: SlotId) => void;
  onTakeCard: (slotId: SlotId) => void;
  onOpenOwnedPrint: (printId: string) => void;
  onFlipCard: () => void;
  onCloseCard: () => void;
  /** The open card finished flying back to its thumbnail; safe to unmount it. */
  onCardClosed: () => void;
  /** Step the face grid to the previous / next page (clamped + ignored while open). */
  onPrevPage: () => void;
  onNextPage: () => void;
};

/** Look up a catalogue print by id (the drawer stores only the frozen id). The
 *  catalogue is whatever deck is loaded, so it has to be passed in rather than
 *  imported — see deck/DeckProvider. */
function printById(prints: CelebrationPrint[], printId: string | null): CelebrationPrint | null {
  if (!printId) return null;
  return prints.find((item) => item.id === printId) ?? null;
}

/**
 * The colour to give something drawn BEHIND the display glass so it lands on screen
 * exactly as it did when the scene went through a post-processing buffer.
 *
 * The glass is a faint (opacity 0.16) lit sheet. Composited in a linear-light float
 * buffer — how the old EffectComposer pipeline blended it — its haze lifts dark text
 * a lot (#1c2228 read as a soft #585c5a). Blended straight into the sRGB canvas it
 * lifts dark colours far less, so the same text came out near-black and the face
 * looked harsher. Rather than pay ~45 MB of full-screen float buffers on a phone to
 * get linear blending back, solve for the colour that gives the linear result under
 * sRGB blending:   c' = (encode(0.84·decode(c) + 0.16·G) − 0.16·encode(G)) / 0.84
 * where G is the glass's lit colour, measured from renders of the old pipeline
 * (sRGB ≈ 197, 203, 196 at the default view). Exact for flat colours; the glass
 * lighting barely changes across the orbit.
 */
const GLASS_OPACITY = 0.16;
const GLASS_LIT_SRGB = [197, 203, 196].map((channel) => channel / 255);
const decodeSrgb = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encodeSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const glassCache = new Map<string, string>();
function behindGlass(hex: string): string {
  const cached = glassCache.get(hex);
  if (cached) return cached;
  const a = GLASS_OPACITY;
  const out = [1, 3, 5].map((offset, channel) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const glass = GLASS_LIT_SRGB[channel];
    const target = encodeSrgb((1 - a) * decodeSrgb(c) + a * decodeSrgb(glass));
    const compensated = Math.min(1, Math.max(0, (target - a * glass) / (1 - a)));
    return Math.round(compensated * 255).toString(16).padStart(2, '0');
  });
  const result = `#${out.join('')}`;
  glassCache.set(hex, result);
  return result;
}

const setCursor = (value: 'pointer' | 'auto') => {
  document.body.style.cursor = value;
};

/**
 * Every click target in the scene that has no look of its own (hit pads, the wheel
 * band, the open-card catcher) carries `<meshBasicMaterial visible={false} />`. The
 * renderer skips an invisible material entirely — no draw, no shadow-pass draw — but
 * R3F's raycaster does not look at visibility, so the pad still takes the pointer.
 * They used to be transparent opacity-0 materials: identical on screen, but each one a
 * real blended draw call every frame.
 */
const hoverable = {
  onPointerOver: (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setCursor('pointer');
  },
  onPointerOut: () => setCursor('auto'),
};

/** A single print thumbnail on the machine face: blurred until owned. Every thumbnail
 *  in the catalogue stays MOUNTED (so its canvas texture is built once, not re-decoded
 *  on every page flip); `visible` hides + disables raycast for prints on other pages. */
function FaceThumb({
  print: item,
  owned,
  position,
  thumb,
  labelOffsetY,
  visible,
  onOpen,
}: {
  print: CelebrationPrint;
  owned: boolean;
  position: [number, number, number];
  thumb: number;
  labelOffsetY: number;
  /** True only when this print is on the page currently showing. */
  visible: boolean;
  onOpen: (printId: string) => void;
}) {
  const { crisp, blurred } = usePrintTextures(item.photo);
  const texture = owned ? crisp : blurred;
  // Title font scales with the thumbnail (clamped so it stays legible / not huge).
  const fontSize = Math.min(0.0092, Math.max(0.004, thumb * 0.14));
  const clickable = owned && visible;

  return (
    <group position={position} visible={visible}>
      <mesh
        // Interactivity is gated SOLELY by whether onClick is present (clickable =
        // owned && visible): R3F only raycasts meshes that carry an event handler, so an
        // off-page or blurred thumbnail (no onClick) is never hit. Do NOT also toggle the
        // `raycast` prop to suppress hits — R3F's applyProps ignores `undefined` values
        // (issue #274), so `raycast={visible ? undefined : () => null}` is a one-way trap:
        // once a thumb renders off-page it keeps the `() => null` no-op FOREVER, and when
        // it later becomes clickable on its page its raycast still returns nothing, so the
        // click never lands. That was the "can't reopen a print after paging to it" bug.
        onClick={
          clickable
            ? (event) => {
                event.stopPropagation();
                onOpen(item.id);
              }
            : undefined
        }
        {...(clickable ? hoverable : {})}
      >
        <planeGeometry args={[thumb, thumb]} />
        <meshBasicMaterial
          key={texture ? 'mapped' : 'flat'}
          map={texture ?? undefined}
          color={texture ? '#ffffff' : '#d8d4c8'}
          toneMapped={false}
        />
      </mesh>
      <Text
        position={[0, labelOffsetY, 0.001]}
        fontSize={fontSize}
        font={owned ? LABEL_FONT : DISPLAY_FONT}
        maxWidth={thumb * 1.05}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        color={behindGlass(owned ? faceLayout.textColor : '#8a8a86')}
      >
        {owned ? item.title : '? ? ?'}
      </Text>
    </group>
  );
}

/**
 * Left `<` / right `>` paging arrow on the face. A flat handwritten chevron over an
 * invisible square hit pad (so the click target is comfortably large even though the
 * glyph is thin). Greyed + non-interactive at the ends of the range.
 */
function PageArrow({
  direction,
  x,
  enabled,
  onClick,
}: {
  direction: 'prev' | 'next';
  x: number;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <group position={[x, faceLayout.grid.centerY, 0.001]}>
      {/* Fat invisible hit pad. Interactivity gated by onClick presence only (see the
          FaceThumb note): toggling `raycast` to `() => null` when disabled would stick the
          no-op forever, so a `prev`/`next` arrow that starts disabled (page 0 / last page)
          would stay unclickable after paging made it enabled. */}
      <mesh
        onClick={
          enabled
            ? (event) => {
                event.stopPropagation();
                onClick();
              }
            : undefined
        }
        {...(enabled ? hoverable : {})}
      >
        <planeGeometry args={[0.026, 0.05]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <Text
        fontSize={0.026}
        font={DISPLAY_FONT}
        anchorX="center"
        anchorY="middle"
        color={behindGlass(enabled ? faceLayout.textColor : '#bcb8ad')}
      >
        {direction === 'prev' ? '‹' : '›'}
      </Text>
    </group>
  );
}

/** A row of page dots under the grid (filled dot = current page). */
function PageDots({ pages, current, y }: { pages: number; current: number; y: number }) {
  const gap = 0.012;
  const startX = -((pages - 1) / 2) * gap;
  return (
    <group position={[0, y, 0.001]}>
      {Array.from({ length: pages }, (_, page) => (
        <mesh key={page} position={[startX + page * gap, 0, 0]}>
          <circleGeometry args={[page === current ? 0.0024 : 0.0016, 16]} />
          <meshBasicMaterial
            color={behindGlass(page === current ? faceLayout.textColor : '#bcb8ad')}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** The illustrated upper face: title, paginated print grid, pager, footer. */
function MachineFace({
  collected,
  gridPage,
  onOpenOwnedPrint,
  onPrevPage,
  onNextPage,
  onGridHoverChange,
}: {
  collected: Set<string>;
  gridPage: number;
  onOpenOwnedPrint: (printId: string) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  /** Notify the scene when the pointer enters/leaves the paging band, so OrbitControls
   *  wheel-zoom can be suspended while the wheel is being used to page the grid. */
  onGridHoverChange: (hovering: boolean) => void;
}) {
  const prints = usePrints();
  const count = prints.length;
  const layout = gridLayout();
  const pages = pageCount(count);
  const multiPage = pages > 1;

  // Paging the grid unmounts/hides the thumbnail the pointer is currently over WITHOUT
  // R3F firing its onPointerOut (the mesh stops raycasting via raycast={()=>null} rather
  // than the pointer leaving it), so the global hover cursor set by `hoverable` would stay
  // stuck as 'pointer' after a wheel-page — and the stale hover reads as "the thumbnails
  // stopped responding". Force the cursor back to default on every page change; the next
  // real pointer move re-fires onPointerOver for whatever is now under it.
  useEffect(() => {
    setCursor('auto');
  }, [gridPage]);

  // Wheel paging over the grid band: one wheel notch = one page. (Drag-to-page was
  // dropped — the grid band covers most of the face, so a drag there is reserved for
  // OrbitControls camera-rotate; paging is via the wheel + the on-screen < / > arrows.)
  const wheelAccum = useRef(0);
  const WHEEL_STEP = 40; // accumulated deltaY for one page

  const stepBy = (delta: number) => {
    if (delta > 0) onNextPage();
    else if (delta < 0) onPrevPage();
  };

  // Grid band bounding box (for the wheel/drag hit plane + arrow placement).
  const bandW = layout.width + 0.05;
  const bandH = layout.rows * layout.rowSpan;

  return (
    <group position={[0, 0, faceLayout.z]}>
      <Text
        position={[0, faceLayout.titleY, 0]}
        fontSize={0.024}
        font={DISPLAY_FONT}
        letterSpacing={0.02}
        anchorX="center"
        anchorY="middle"
        color={behindGlass(faceLayout.textColor)}
      >
        MINI PRINT
      </Text>
      <Text
        position={[0, faceLayout.subtitleY, 0]}
        fontSize={0.0165}
        font={DISPLAY_FONT}
        letterSpacing={0.02}
        anchorX="center"
        anchorY="middle"
        color={behindGlass(faceLayout.textColor)}
      >
        VENDING MACHINE
      </Text>

      {/* Wheel-paging surface behind the thumbnails (only when there's more than one
          page). Invisible; sits a hair behind the thumbs so it catches the wheel but
          thumbnails still take clicks first. onPointerOver/Out gate OrbitControls zoom
          so the wheel pages instead of dollying. Pointer-DOWN is intentionally NOT
          handled here, so a drag falls through to OrbitControls camera-rotate. */}
      {multiPage ? (
        <mesh
          position={[0, faceLayout.grid.centerY, -0.001]}
          onPointerOver={(event) => {
            event.stopPropagation();
            onGridHoverChange(true);
          }}
          onPointerOut={() => onGridHoverChange(false)}
          onWheel={(event) => {
            event.stopPropagation();
            wheelAccum.current += event.deltaY;
            while (Math.abs(wheelAccum.current) >= WHEEL_STEP) {
              stepBy(Math.sign(wheelAccum.current));
              wheelAccum.current -= Math.sign(wheelAccum.current) * WHEEL_STEP;
            }
          }}
        >
          <planeGeometry args={[bandW, bandH]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ) : null}

      {prints.map((item, index) => {
        // Single source of truth for thumb placement + size (also used by the card's
        // close animation). Every print sits at its slot on its OWN page; only prints on
        // the visible page are shown + clickable. The helper returns cabinet-frame
        // (x, y, z); this group is already offset to faceLayout.z, so drop the z here.
        const [thumbX, thumbY] = thumbWorldPosition(thumbSlotOnPage(index));
        return (
          <FaceThumb
            key={item.id}
            print={item}
            owned={collected.has(item.id)}
            position={[thumbX, thumbY, 0]}
            thumb={layout.thumb}
            labelOffsetY={layout.labelOffsetY}
            visible={pageOfIndex(index) === gridPage}
            onOpen={onOpenOwnedPrint}
          />
        );
      })}

      {/* Pager: arrows flank the grid, dots sit just above the footer. Only when >1 page. */}
      {multiPage ? (
        <>
          <PageArrow direction="prev" x={-bandW / 2} enabled={gridPage > 0} onClick={onPrevPage} />
          <PageArrow direction="next" x={bandW / 2} enabled={gridPage < pages - 1} onClick={onNextPage} />
          <PageDots pages={pages} current={gridPage} y={faceLayout.footerY + 0.018} />
        </>
      ) : null}

      <Text
        position={[0, faceLayout.footerY, 0]}
        fontSize={0.0112}
        font={DISPLAY_FONT}
        letterSpacing={0.01}
        maxWidth={layout.width}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        color={behindGlass(faceLayout.textColor)}
      >
        4 QUARTERS = 1 SURPRISE PRINT
      </Text>
    </group>
  );
}

/**
 * One coin slot in the assembled machine: the chrome Handle mechanism plus the
 * folded card emerging above it, with an invisible hit area routing clicks to the
 * per-slot state machine (advance the drawer, or take the dispensed card).
 */
function Drawer({
  slotId,
  drawer,
  print: item,
  isOpenCardSource,
  openFlipped,
  scrollState,
  onAdvanceDrawer,
  onTakeCard,
  onCardClosed,
}: {
  slotId: SlotId;
  drawer: MachineState['drawers'][SlotId];
  print: CelebrationPrint | null;
  /** True only while this slot's card is OPEN at the viewer (not while it closes — the
   *  closing card must read as 'stowed' so it fires the fly-home animation). */
  isOpenCardSource: boolean;
  openFlipped: boolean;
  /** Shared back-message scroll state (only the open card reads/publishes it). */
  scrollState: MessageScrollState;
  onAdvanceDrawer: (slotId: SlotId) => void;
  onTakeCard: (slotId: SlotId) => void;
  /** Only meaningful for the open slot: the card finished flying home. */
  onCardClosed?: () => void;
}) {
  const prints = usePrints();
  const cardState: 'stowed' | 'dispensed' | 'open' = isOpenCardSource
    ? 'open'
    : drawer.status === 'dispensed'
      ? 'dispensed'
      : 'stowed';

  return (
    <group position={[slotX[slotId], handle.centerY, cabinet.faceZ + handle.mountZ]}>
      <Handle
        status={drawer.status}
        coins={drawer.coins}
        // Click the coin slots: drop one quarter (loading, < 4 coins).
        onAddCoin={() => {
          if (drawer.status === 'loading' && drawer.coins < COINS_REQUIRED) {
            onAdvanceDrawer(slotId);
          }
        }}
        // Click $1.00: push in (4 coins loaded) or pull out (already pushed in).
        onPushPull={() => {
          if (drawer.status === 'loading' && drawer.coins >= COINS_REQUIRED) {
            onAdvanceDrawer(slotId);
          } else if (drawer.status === 'pushed_in') {
            onAdvanceDrawer(slotId);
          }
        }}
      />

      {/* Card: positions itself within this Drawer-local frame (origin at the
          handle centre). Slides flat out the slit above the slots; clicking the
          protruding card takes it; on close it flies to its OWN face thumbnail and
          disappears (stowTargetWorld = that thumbnail's world position). */}
      {item ? (
        <FoldedCardPart
          print={item}
          state={cardState}
          flipped={openFlipped}
          onTake={() => onTakeCard(slotId)}
          onClosed={onCardClosed}
          scrollState={scrollState}
          stowTargetWorld={thumbWorldPosition(thumbSlotOnPage(prints.indexOf(item)))}
        />
      ) : null}
    </group>
  );
}

export function MachineScene({
  machine,
  collected,
  openCard,
  openPrint,
  gridPage,
  onAdvanceDrawer,
  onTakeCard,
  onOpenOwnedPrint,
  onFlipCard,
  onCloseCard,
  onCardClosed,
  onPrevPage,
  onNextPage,
}: MachineSceneProps) {
  // Suspend OrbitControls wheel-zoom while the pointer is over the paging band, so the
  // wheel pages the grid instead of dollying the camera (R3F's onWheel stopPropagation
  // does NOT reach OrbitControls' own native wheel listener).
  const prints = usePrints();
  const [gridHovered, setGridHovered] = useState(false);
  // Shared back-message scroll state: the open card measures its overflow into `max` and
  // eases its visible offset toward `target`; the card interaction layer writes `target`
  // from wheel/drag. A plain ref (not React state) — it's touched every frame. Only one
  // card is ever open, so one shared cell suffices.
  const scrollState = useRef<MessageScrollState>({ target: 0, max: 0 });
  return (
    <>
      {/* Temporary warm scene background so the frame isn't black before the cozy
          bookstore wall is built (slice 3 covers most of it). A soft warm cream. */}
      <color attach="background" args={['#efe6d6']} />

      {/* WARM cozy-bookstore lighting. The HDRI now supplies reflections ONLY (no
          background), so the explicit lights carry the mood: a warm ambient fill, a
          warm key from the upper-front-right (drives the soft cast shadow +
          ContactShadows direction), and a small COOL fill so the shadow side doesn't
          go muddy. Intensities stay modest under ACES so the glossy red + chrome
          never clip. */}
      <ambientLight intensity={0.45} color="#ffe9d0" />
      <directionalLight
        castShadow
        intensity={0.85}
        color="#ffd9a0"
        position={[0.9, 1.3, 0.8]}
        // The default shadow camera spans 10 m × 10 m, most of it empty, so a 2048 map
        // spent ~5 mm a texel. These bounds are the light-space box around everything
        // that casts (machine, shelves, books — computed from bookstore.shelving and
        // the pedestal) with a margin, so 1024 on a phone is already finer than the
        // old map (a quarter of the memory and fill) and 2048 on desktop is twice as
        // fine. `near` stays three's default 0.5 so the same casters are clipped.
        shadow-mapSize-width={quality.shadowMapSize}
        shadow-mapSize-height={quality.shadowMapSize}
        shadow-camera-left={-1.2}
        shadow-camera-right={2.3}
        shadow-camera-bottom={-1.6}
        shadow-camera-top={2.9}
        shadow-camera-far={4.5}
      />
      <directionalLight intensity={0.22} color="#cfd8e6" position={[-0.8, 0.7, 0.5]} />
      {/* HDRI used for REFLECTIONS ONLY (background={false}) so the red enamel + chrome
          read as real painted metal. Degrades to the explicit warm lights above if the
          HDRI file is absent. */}
      <LibraryEnvironment />

      {/* The cozy bookstore set the machine stands in: warm honey-wood plank floor
          (+ cream wall + bookshelf, added next). Owns the VISIBLE floor that receives
          the grounding shadow; ContactShadows below adds the close contact darkening. */}
      <BookstoreBackdrop />

      {/* The cabinet (body + frame + glass + pole + base). */}
      <CabinetBody />

      {/* The illustrated face (grid + title + pager) on top of the white face. */}
      <MachineFace
        collected={collected}
        gridPage={gridPage}
        onOpenOwnedPrint={onOpenOwnedPrint}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        onGridHoverChange={setGridHovered}
      />

      {/* Three coin handles + their cards. */}
      {slotOrder.map((slotId) => {
        const isOpenSlot = openCard?.slotId === slotId;
        // The open slot shows the taken print (openPrint) for the WHOLE open→close arc —
        // including while closing, so the fly-home keeps the right image + thumbnail
        // target. Other slots show whatever print is frozen in their drawer (chosen at
        // pull time), or nothing when idle/empty.
        const drawerPrint = isOpenSlot
          ? openPrint
          : printById(prints, machine.drawers[slotId].dispensedPrintId);
        return (
          <Drawer
            key={slotId}
            slotId={slotId}
            drawer={machine.drawers[slotId]}
            print={drawerPrint}
            // Open (resting at the viewer) only while NOT closing: once closing, the card
            // must read as 'stowed' so FoldedCardPart runs the fold + fly-home animation
            // while still bound to openPrint.
            isOpenCardSource={isOpenSlot && !openCard?.closing}
            openFlipped={openCard?.flipped ?? false}
            scrollState={scrollState.current}
            onAdvanceDrawer={onAdvanceDrawer}
            onTakeCard={onTakeCard}
            onCardClosed={isOpenSlot ? onCardClosed : undefined}
          />
        );
      })}

      {/* While a card is open: a click-catcher to flip / dismiss + scroll the message. */}
      {openCard && openPrint ? (
        <CardInteractionLayer
          onFlip={onFlipCard}
          onClose={onCloseCard}
          scrollState={scrollState.current}
          flipped={openCard.flipped}
        />
      ) : null}

      {/* Soft contact darkening right under the base, sitting ON the wood floor (a hair
          above its surface, below the dome rim, to avoid z-fighting). Adds the close
          ambient-occlusion contact the cast shadow alone can't, so the base reads as
          RESTING on the floor. */}
      {/* frames={1}: bake it once. Nothing that moves ever comes within `far` of the
          floor (the handles and cards live up at the cabinet), so re-rendering the
          whole scene from below plus two blur passes EVERY frame — the default — bought
          nothing and cost a second full scene draw per frame. */}
      <ContactShadows
        frames={1}
        position={[0, floor.y - 0.0015, 0]}
        opacity={0.5}
        scale={0.9}
        blur={2.4}
        far={0.6}
      />
      <OrbitControls
        enabled={!openCard}
        enablePan={false}
        // Disable wheel-zoom while the pointer is on the paging band (the wheel pages
        // the grid there instead) — otherwise OrbitControls dollies the camera.
        enableZoom={!gridHovered}
        minDistance={0.55}
        maxDistance={2.2}
        target={[0, lowerPanel.centerY + 0.1, cabinet.faceZ]}
        minPolarAngle={Math.PI / 3.2}
        maxPolarAngle={Math.PI / 1.95}
        // Front hemisphere only (±90° from dead-on): the cozy bookstore set has no
        // geometry behind the wall, so orbiting past the sides would let the camera
        // slip behind the book wall and clip through it.
        minAzimuthAngle={-Math.PI / 2}
        maxAzimuthAngle={Math.PI / 2}
      />

      {/* No post-processing chain. It was N8AO + a normal pass + SMAA + a vignette,
          which re-drew the scene for normals and held ~90 MB of full-screen float
          buffers on a phone. AA is native MSAA now (App's gl.antialias) and the
          vignette is a CSS overlay (styles.css .scene-vignette); the AO was set to a
          whisper that only touched deep crevices, which the contact shadow + key-light
          shadow already carry. */}
    </>
  );
}

/**
 * Full-screen interaction while a card is open: a transparent plane locked in front of
 * the camera. The card area flips on a CLICK and scrolls the back message on WHEEL or
 * VERTICAL DRAG (when flipped to the back); a click outside closes. A drag is told apart
 * from a click by movement distance, so dragging to scroll never also flips. OrbitControls
 * is disabled while a card is open, so there's no camera conflict here.
 */
function CardInteractionLayer({
  onFlip,
  onClose,
  scrollState,
  flipped,
}: {
  onFlip: () => void;
  onClose: () => void;
  scrollState: MessageScrollState;
  flipped: boolean;
}) {
  const ref = useRef<Group>(null);
  const camera = useThree((state) => state.camera);
  // Scrolling only moves a number the open card eases toward; on an on-demand canvas
  // it has to ask for the frame that starts the ease.
  const invalidate = useThree((state) => state.invalidate);
  const forward = useMemo(() => new Vector3(), []);
  const pos = useMemo(() => new Vector3(), []);
  // Drag tracking: the pointer's local Y at press + whether it moved enough to count as
  // a scroll-drag (so the pointer-up doesn't also flip).
  const dragY = useRef<number | null>(null);
  const dragged = useRef(false);
  const CLICK_SLOP = 0.004; // world metres of travel below which it's a click, not a drag

  useFrame(() => {
    const group = ref.current;
    if (!group) return;
    camera.getWorldDirection(forward);
    // Sit the click-catcher ~2cm IN FRONT of the open card (which rests at
    // card.viewerDistance) so the flip ray hits it first; the backdrop mesh inside
    // (local z -0.04) stays behind the card to close on outside clicks.
    pos.copy(camera.position).addScaledVector(forward, card.viewerDistance - 0.02);
    group.position.copy(pos);
    group.quaternion.copy(camera.quaternion);
  });

  const clampTarget = () => {
    scrollState.target = Math.min(scrollState.max, Math.max(0, scrollState.target));
  };

  return (
    <group ref={ref}>
      {/* Outside-card backdrop: closes on click. */}
      <mesh position={[0, 0, -0.04]} onClick={(event) => { event.stopPropagation(); onClose(); }}>
        <planeGeometry args={[3, 3]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* Card-area: click flips; wheel / vertical drag scrolls the back message. */}
      <mesh
        position={[0, print.height * 0.4, 0]}
        onWheel={(event) => {
          event.stopPropagation();
          if (!flipped) return; // only the back message scrolls
          // Drag DOWN content == wheel down reveals lower text: target increases.
          scrollState.target += event.deltaY * card.message.wheelSpeed;
          clampTarget();
          invalidate();
        }}
        onPointerDown={(event) => {
          dragY.current = event.point.y;
          dragged.current = false;
        }}
        onPointerMove={(event) => {
          if (dragY.current == null) return;
          const dy = event.point.y - dragY.current;
          if (Math.abs(dy) > CLICK_SLOP) dragged.current = true;
          if (!flipped) return;
          // Drag UP (dy<0) reveals lower text (target increases): subtract dy.
          scrollState.target -= dy * card.message.dragSpeed;
          clampTarget();
          invalidate();
          dragY.current = event.point.y; // incremental
        }}
        onPointerUp={() => {
          dragY.current = null;
        }}
        onClick={(event) => {
          event.stopPropagation();
          // A drag that scrolled should not also flip.
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onFlip();
        }}
        {...hoverable}
      >
        <planeGeometry args={[print.width * 1.3, print.height * 2.1]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}
