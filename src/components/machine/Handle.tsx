import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DataTexture,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  MathUtils,
  RepeatWrapping,
  RGBAFormat,
  Shape,
  SRGBColorSpace,
  Vector2,
} from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import type { DrawerStatus } from '../../App';
import { DAMP_HANDLE, DISPLAY_FONT, handle } from '../../lib/dimensions';

/**
 * The chrome coin HANDLE mechanism, modelled on a real ESD Standard V-5. THREE
 * real objects (see the `handle` block in dimensions.ts):
 *
 *   1. FRAME (STATIC): a flat square chrome bezel bolted to the white face. A
 *      black foam strip runs across its top edge; screws at the top corners + a
 *      tiny center fastener. The FIVE COIN SLOTS are cut into the frame's upper
 *      area (NOT the tongue) — the user drops quarters into the FIXED frame, so
 *      the slots never slide. Left 4 slots open, 5th (blindIndex) sealed.
 *   2. RAIL HOUSING (STATIC): floor + two low side cheeks + front-to-back rails.
 *   3. TONGUE (SLIDES on Z): a long, thin, FLAT hammered-metal slab with a
 *      recessed logo panel; a small upturned PULL TAB at the user end carries the
 *      "$1.00" plate. Its flat top passes UNDER the frame's slot row.
 *
 * Slides in Z by `status`: 'loading'/'dispensed' = out (neutral), 'pushed_in'
 * and 'sold_out' = retracted. `coins` (0..4) quarters show in the FRAME's slots
 * while loading. Only the TONGUE moves. The folded card is rendered by
 * FoldedCardPart.
 *
 * CLICK TARGETS:
 *   - the FRAME coin-slot deck (STATIC) -> `onAddCoin` (drop one quarter/click)
 *   - the $1.00 plate on the moving pull tab -> `onPushPull` (push in / pull out)
 *
 * OWNED BY: handle part (hand-built). Tune numbers in dimensions.ts (handle
 * block). Rendered centred near origin; the parent group places it per slot.
 */
export function Handle({
  status = 'loading',
  coins = 0,
  onAddCoin,
  onPushPull,
}: {
  status?: DrawerStatus;
  coins?: number;
  onAddCoin?: () => void;
  onPushPull?: () => void;
}) {
  const innerRef = useRef<Group>(null);
  const scratch = useChromeScratches();
  const hammered = useHammeredMetal();
  const dollarPlate = useDollarPlateTexture();

  const { frame, outer, inner, coinSlots, coin, label, chrome } = handle;

  // Flat trapezoid $1.00 plate (wider at the bottom) with proper [0,1] front-face
  // UVs; the whole sticker (blue border + cream face + "$1.00") is BAKED onto its
  // map. A custom single-quad geometry — NOT buildTrapezoid's ExtrudeGeometry,
  // whose default cap UVs are raw vertex coords (~±0.015) that cluster the whole
  // face onto one blue texel.
  const labelGeometry = useMemo(
    () => buildLabelPlate(label.width, label.height, label.topScale),
    [label.width, label.height, label.topScale],
  );

  // The tongue: a flat slab with back cutouts that register with the frame slots,
  // plus a small upturned trapezoid pull tab at the user end. Shared across all
  // three handles.
  const tongueGeometry = useMemo(() => buildTongueGeometry(), []);
  // Trapezoid pull-tab flange (tapered like the $1.00 plate), centred on Z.
  const pullTabGeometry = useMemo(() => {
    const geometry = buildTrapezoid(inner.pullTab.width, inner.pullTab.height, inner.pullTab.topScale, inner.pullTab.thickness);
    geometry.translate(0, 0, -inner.pullTab.thickness / 2);
    return geometry;
  }, [inner.pullTab.width, inner.pullTab.height, inner.pullTab.topScale, inner.pullTab.thickness]);

  const chromeProps = {
    color: chrome.color,
    roughness: chrome.roughness,
    metalness: chrome.metalness,
    roughnessMap: scratch,
    envMapIntensity: 0.7,
  };

  // Hammered cast-metal look for the tongue slab (pebbled, light-catching),
  // contrasting the polished bezel/plate.
  const hammeredProps = {
    color: inner.color,
    roughness: 0.3,
    metalness: 1,
    roughnessMap: hammered.roughnessMap,
    normalMap: hammered.normalMap,
    normalScale: new Vector2(0.32, 0.32),
    envMapIntensity: 0.7,
  };

  // Tucked in when pushed (coins swallowed) or sold out; out otherwise.
  const tuckedIn = status === 'pushed_in' || status === 'sold_out';

  const handleClick =
    (action?: () => void) => (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      action?.();
    };
  const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    document.body.style.cursor = 'pointer';
  };
  const onPointerOut = () => {
    document.body.style.cursor = 'auto';
  };

  useFrame((_, delta) => {
    const node = innerRef.current;
    if (!node) return;
    const targetZ = tuckedIn ? handle.zIn : handle.zOut;
    node.position.z = MathUtils.damp(node.position.z, targetZ, DAMP_HANDLE, delta);
  });

  // ---- Static housing layout (floor + cheeks + rails). ----
  const floorY = -handle.height / 2 + outer.floorThickness / 2;
  const railTopY = floorY + outer.floorThickness / 2 + outer.rail.height / 2;
  const wallY = floorY + outer.floorThickness / 2 + outer.wallHeight / 2;
  const wallX = outer.innerClearWidth / 2 + outer.wallThickness / 2;
  const railStartX = -((outer.rail.count - 1) / 2) * outer.rail.pitch;

  // The tongue's drawn origin: y=0 = slab bottom. Rest the slab on the rail tops.
  const slabBottomY = railTopY + outer.rail.height / 2 + inner.liftY;

  // ---- Static frame bezel layout. ----
  // Plate centre Z (the plate spans [frontZ - thickness, frontZ]).
  const frameCenterZ = frame.frontZ - frame.thickness / 2;
  const frameFrontZ = frame.frontZ;
  // The slot row sits in the bezel's upper area; coins/slots/hit-area all key off
  // this single Y (no mirror reconciliation — the frame group is UNROTATED, so
  // slot index i maps directly to world X via slotWorldX(i)).
  const slotRowY = frame.centerY + coinSlots.rowOffsetY;
  const slotStartX = -((coinSlots.count - 1) / 2) * coinSlots.pitch;
  const slotWorldX = (index: number) => slotStartX + index * coinSlots.pitch;
  // The slits stand a hair proud of the bezel face so they read as dark cuts.
  const slotFrontZ = frameFrontZ + 0.0005;
  // Screw corner positions on the bezel face.
  const screwX = frame.width / 2 - frame.screw.inset;
  const screwY = frame.centerY + frame.height / 2 - frame.screw.inset;

  return (
    <group>
      {/* ================= STATIC FRAME BEZEL ================= */}
      {/* Chrome plate bolted to the face. */}
      <mesh position={[0, frame.centerY, frameCenterZ]} castShadow receiveShadow>
        <boxGeometry args={[frame.width, frame.height, frame.thickness]} />
        <meshStandardMaterial {...chromeProps} color={frame.color} />
      </mesh>

      {/* Black foam gasket strip across the TOP edge of the bezel. */}
      <mesh
        position={[
          0,
          frame.centerY + frame.height / 2 - frame.foam.height / 2,
          frameFrontZ + frame.foam.proud / 2,
        ]}
      >
        <boxGeometry args={[frame.width, frame.foam.height, frame.foam.proud]} />
        <meshStandardMaterial color={frame.foam.color} roughness={0.95} metalness={0.0} />
      </mesh>

      {/* Two corner screws + one tiny centre fastener (between the slot row and the
          foam strip). */}
      {[
        [-screwX, screwY] as const,
        [screwX, screwY] as const,
        [0, slotRowY + coinSlots.length / 2 + frame.screw.radius * 1.5] as const,
      ].map(([sx, sy], index) => (
        <mesh
          key={`screw-${index}`}
          position={[sx, sy, frameFrontZ + frame.screw.length / 2]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[frame.screw.radius, frame.screw.radius, frame.screw.length, 16]} />
          <meshStandardMaterial {...chromeProps} color={frame.screw.color} />
        </mesh>
      ))}

      {/* Dark cavity directly behind each open slit so it reads as a channel coins
          drop into, not a see-through gap. Snug to each slit (not a slab across
          the whole bezel), set just behind the plate front so the chrome plate
          stays visible around the slits. */}
      {Array.from({ length: coinSlots.count }).map((_, index) =>
        index === coinSlots.blindIndex ? null : (
          <mesh key={`cavity-${index}`} position={[slotWorldX(index), slotRowY, frameFrontZ - 0.0018]}>
            <boxGeometry args={[coinSlots.width + 0.0015, coinSlots.length + 0.001, 0.0016]} />
            <meshStandardMaterial color={coinSlots.openColor} roughness={0.85} metalness={0.05} />
          </mesh>
        ),
      )}

      {/* Five coin slots. Open slits (left 4) are thin dark vertical boxes proud of
          the bezel face; the 5th (blindIndex) is a flush chrome fill (sealed). */}
      {Array.from({ length: coinSlots.count }).map((_, index) =>
        index === coinSlots.blindIndex ? (
          <mesh key={`slot-${index}`} position={[slotWorldX(index), slotRowY, frameFrontZ + 0.0003]}>
            <boxGeometry args={[coinSlots.width, coinSlots.length, 0.001]} />
            <meshStandardMaterial
              {...chromeProps}
              color={coinSlots.filledColor}
              polygonOffset
              polygonOffsetFactor={-2}
              polygonOffsetUnits={-2}
            />
          </mesh>
        ) : (
          <mesh key={`slot-${index}`} position={[slotWorldX(index), slotRowY, slotFrontZ]}>
            <boxGeometry args={[coinSlots.width, coinSlots.length, coinSlots.depth]} />
            <meshStandardMaterial color={coinSlots.openColor} roughness={0.9} metalness={0.05} />
          </mesh>
        ),
      )}

      {/* Quarters dropped through the frame slots into the tongue cutouts behind,
          ONE AT A TIME (0..4 by `coins`). Each is a thin vertical disc (axis along
          X) seated DOWN in the slot/cutout channel: sunk BELOW the slot-row centre
          so it nests into the tongue cutout (otherwise it reads as floating), with
          only the top arc rising through the open slit. Sits just BEHIND the bezel
          front (in the slot, not proud of it). */}
      {Array.from({ length: Math.max(0, Math.min(4, coins)) }).map((_, index) => (
        <mesh
          key={`coin-${index}`}
          position={[slotWorldX(index), slotRowY - coin.radius * 0.55, frameFrontZ - 0.001]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[coin.radius, coin.radius, coin.thickness, 28]} />
          <meshStandardMaterial color={coin.color} roughness={0.32} metalness={0.85} />
        </mesh>
      ))}

      {/* Invisible hit area over the FRAME's slot row -> drop one quarter. Static
          (does not track the tongue slide). Kept SHALLOW and tucked just in front
          of the bezel face — it must NOT protrude forward toward the camera, or it
          steals the ray meant for the $1.00 pull-tab plate further forward (the
          pull-mechanism click was registering as a coin click). */}
      <mesh
        position={[0, slotRowY, frameFrontZ + 0.004]}
        onClick={handleClick(onAddCoin)}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <boxGeometry
          args={[coinSlots.pitch * coinSlots.count + 0.008, coinSlots.length + 0.006, 0.006]}
        />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* ================= STATIC RAIL HOUSING ================= */}
      <mesh position={[0, floorY, 0]} castShadow receiveShadow>
        <boxGeometry args={[outer.innerClearWidth + 2 * outer.wallThickness, outer.floorThickness, outer.floorDepth]} />
        <meshStandardMaterial {...chromeProps} color={outer.color} />
      </mesh>
      <mesh position={[-wallX, wallY, 0]} castShadow receiveShadow>
        <boxGeometry args={[outer.wallThickness, outer.wallHeight, outer.wallDepth]} />
        <meshStandardMaterial {...chromeProps} color={outer.color} />
      </mesh>
      <mesh position={[wallX, wallY, 0]} castShadow receiveShadow>
        <boxGeometry args={[outer.wallThickness, outer.wallHeight, outer.wallDepth]} />
        <meshStandardMaterial {...chromeProps} color={outer.color} />
      </mesh>
      {Array.from({ length: outer.rail.count }).map((_, index) => (
        <mesh
          key={`rail-${index}`}
          position={[railStartX + index * outer.rail.pitch, railTopY, 0]}
          castShadow
        >
          <boxGeometry args={[outer.rail.width, outer.rail.height, outer.rail.depth]} />
          <meshStandardMaterial {...chromeProps} />
        </mesh>
      ))}

      {/* ================= TONGUE (slides in/out on Z) ================= */}
      <group ref={innerRef} position={[0, slabBottomY, handle.zOut]}>
        {/* Flat hammered-metal slab. The profile's front (+x) runs to world +Z
            (toward viewer); the extrude width runs along world X. */}
        <mesh geometry={tongueGeometry} rotation={[0, -Math.PI / 2, 0]} castShadow receiveShadow>
          <meshStandardMaterial {...hammeredProps} />
        </mesh>

        {/* Recessed logo panel on the slab top (plain — no text). A shallow darker
            inset rectangle that reads as the embossed ESD panel. Slightly below
            the slab top so it sits in a recess; pulled in from the user end. */}
        <mesh position={[0, inner.thickness - inner.logoPanel.recessDepth, 0.006]}>
          <boxGeometry args={[inner.logoPanel.width, 0.0006, inner.logoPanel.length]} />
          <meshStandardMaterial
            color={inner.logoPanel.color}
            roughness={0.45}
            metalness={0.95}
            roughnessMap={hammered.roughnessMap}
          />
        </mesh>

        {/* Upturned PULL TAB at the user (+Z) end: a TRAPEZOID flange (tapered like
            the $1.00 plate) standing proud of the slab; the plate sits on its
            front (+Z) face. The trapezoid is built in XY (taper toward the top)
            and extruded along +Z by the tab thickness, recentred on Z. */}
        <group
          position={[0, inner.thickness + inner.pullTab.height / 2, inner.length / 2 - inner.pullTab.thickness / 2]}
        >
          <mesh geometry={pullTabGeometry} castShadow receiveShadow>
            <meshStandardMaterial {...chromeProps} color={inner.color} />
          </mesh>

          {/* Trapezoid $1.00 plate on the tab's front face. The blue border, cream
              face, and "$1.00" text are all BAKED into one CanvasTexture on a single
              quad — so there is nothing coplanar to z-fight and, crucially, the text
              is texels that mip-map and filter like any surface. (The old version
              drew the glyphs with drei <Text>, whose SDF glyph quads alpha-clip thin
              strokes at grazing angles: the thinnest glyph, the `$`, dropped out
              when the plate foreshortened. A baked texture has no such cutoff.)
              depthTest stays ON (default) so the dispensed card occludes it when it
              slides over. Clicking the hit area pushes in / pulls out. */}
          <group position={[0, 0, inner.pullTab.thickness / 2 + 0.0004]}>
            {/* Mount the plate ONLY once the baked texture exists, so the material
                compiles WITH the map. (Starting at map={null} compiles a no-texture
                shader; later assigning map doesn't recompile it, so the plate stayed
                flat white. The `key` forces a fresh material if the texture swaps.) */}
            {dollarPlate && (
              <mesh geometry={labelGeometry} key={dollarPlate.uuid}>
                <meshBasicMaterial map={dollarPlate} toneMapped={false} />
              </mesh>
            )}
            {/* Invisible hit area covering the plate -> push in / pull out. Frontmost
                so a ray reliably hits it before the slab/frame behind. */}
            <mesh
              position={[0, 0, 0.005]}
              onClick={handleClick(onPushPull)}
              onPointerOver={onPointerOver}
              onPointerOut={onPointerOut}
            >
              <boxGeometry args={[label.width * 1.3, label.height * 1.6, 0.006]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

/**
 * The tongue slab geometry: a flat slab at constant thickness with FIVE slots cut
 * into its BACK edge that REGISTER with the frame's coin slots (a coin drops
 * through the frame slot into the matching slab cutout; pushing the slab carries
 * it in). Built in the slab's LOCAL frame then rendered with rotation
 * [0,-PI/2,0]. Shape XY where x = front→back depth (Shape +x = user/front end),
 * y = height; extruded along Shape Z = part width, recentred to [0,0,-width/2].
 *
 * MIRRORING GOTCHA (same as the old deck cuts): the render rotation maps
 * geometry-local +Z → world −X, so to land cutout i at the SAME world X as frame
 * slot i (slotWorldX(i)), the cutter is placed at local Z = −slotWorldX(i). The
 * blind slot (coinSlots.blindIndex) is NOT cut (sealed, matching the frame).
 */
function buildTongueGeometry(): BufferGeometry {
  const { inner, coinSlots } = handle;
  const halfLength = inner.length / 2;

  const shape = new Shape();
  shape.moveTo(-halfLength, 0); // back-bottom
  shape.lineTo(halfLength, 0); // front-bottom
  shape.lineTo(halfLength, inner.thickness); // front-top
  shape.lineTo(-halfLength, inner.thickness); // back-top
  shape.closePath();

  const baseGeometry = new ExtrudeGeometry(shape, {
    depth: inner.width,
    bevelEnabled: false,
    steps: 1,
  });
  baseGeometry.translate(0, 0, -inner.width / 2);

  // Cutter X (front→back): the cut runs from the back edge forward by
  // backCutouts.length, sitting `inset` forward of the very back edge.
  const cutLength = inner.backCutouts.length;
  const cutCenterX = -halfLength + inner.backCutouts.inset + cutLength / 2;
  const cutterHeight = inner.thickness + 0.01; // pierce the slab fully
  // World X of frame slot i; negate for the local-Z reconciliation (see gotcha).
  const slotStartX = -((coinSlots.count - 1) / 2) * coinSlots.pitch;
  const slotWorldX = (index: number) => slotStartX + index * coinSlots.pitch;

  const evaluator = new Evaluator();
  evaluator.useGroups = false;

  let accumulator = new Brush(baseGeometry);
  accumulator.updateMatrixWorld();

  for (let index = 0; index < coinSlots.count; index += 1) {
    if (index === coinSlots.blindIndex) continue; // 5th stays solid (sealed)
    const cutterGeometry = new BoxGeometry(cutLength, cutterHeight, coinSlots.width);
    const cutter = new Brush(cutterGeometry);
    cutter.position.set(cutCenterX, inner.thickness / 2, -slotWorldX(index));
    cutter.updateMatrixWorld();
    accumulator = evaluator.evaluate(accumulator, cutter, SUBTRACTION);
    cutterGeometry.dispose();
  }

  const holed = accumulator.geometry;
  holed.computeVertexNormals();
  return holed;
}

/**
 * A trapezoid plate centred on the origin in XY (for the $1.00 label and the pull
 * tab): `width` at the bottom edge, `width * topScale` at the top edge, `height`
 * tall, extruded along +Z by `depth` (default 0.0006 for the thin label layers).
 */
function buildTrapezoid(width: number, height: number, topScale: number, depth = 0.0006) {
  const halfBottom = width / 2;
  const halfTop = (width * topScale) / 2;
  const halfHeight = height / 2;
  const shape = new Shape();
  shape.moveTo(-halfBottom, -halfHeight);
  shape.lineTo(halfBottom, -halfHeight);
  shape.lineTo(halfTop, halfHeight);
  shape.lineTo(-halfTop, halfHeight);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
}

/**
 * A FLAT trapezoid quad facing +Z for the baked $1.00 sticker: `width` at the
 * bottom edge, `width * topScale` at the top, `height` tall, centred on the
 * origin. Carries explicit [0,1] front-face UVs (the canvas square maps straight
 * onto the four corners) so the texture lands correctly — unlike ExtrudeGeometry,
 * whose default cap UVs are raw vertex coords and bunch the whole face onto one
 * texel. The texture pre-compensates the trapezoid taper in its paint (see
 * useDollarPlateTexture). UV v is flipped (canvas y=0 top → v=1) so the sticker
 * reads upright.
 */
function buildLabelPlate(width: number, height: number, topScale: number): BufferGeometry {
  const halfBottom = width / 2;
  const halfTop = (width * topScale) / 2;
  const halfHeight = height / 2;

  const geometry = new BufferGeometry();
  // Corners: 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left.
  const positions = [
    -halfBottom, -halfHeight, 0,
    halfBottom, -halfHeight, 0,
    halfTop, halfHeight, 0,
    -halfTop, halfHeight, 0,
  ];
  const uvs = [
    0, 0, // bottom-left  -> canvas bottom-left
    1, 0, // bottom-right -> canvas bottom-right
    1, 1, // top-right    -> canvas top-right
    0, 1, // top-left     -> canvas top-left
  ];
  const indices = [0, 1, 2, 0, 2, 3];
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The "$1.00" plate sticker baked onto ONE quad: blue border, cream face, and the
 * "$1.00" glyphs all painted into a single CanvasTexture. Baking (vs drawing the
 * text with drei <Text>) is what keeps the `$` from dropping out at grazing
 * angles: SDF glyph quads alpha-clip their thin strokes when foreshortened, but a
 * texture's text is just texels that mip-map and filter like any other surface.
 *
 * UV NOTE: the plate is a TRAPEZOID (narrower at the top by `label.topScale`), but
 * ExtrudeGeometry derives UVs from the shape's XY bounding box, so v→top still maps
 * to the full u=[0,1] width — i.e. the canvas's top row gets squeezed into the
 * narrower top edge, stretching art near the top horizontally. To land upright,
 * even-margined text on the rendered plate, the cream face + text are themselves
 * painted into a matching taper (top row inset to `topScale`), pre-compensating the
 * UV squeeze. sRGB + linear filtering, mirroring src/lib/textures.ts.
 */
function useDollarPlateTexture(): CanvasTexture | null {
  const { label } = handle;
  const [texture, setTexture] = useState<CanvasTexture | null>(null);

  // The "$1.00" glyphs must be drawn in DISPLAY_FONT (Permanent Marker — the same
  // marker face as the machine title / "4 QUARTERS"), so the baked sticker matches
  // the rest of the display text. Canvas fillText only honours a font once it is
  // LOADED, so register + await the FontFace before painting, then publish the
  // texture (mirrors the async-decode pattern in src/lib/textures.ts). Painted once
  // (label is a constant); StrictMode double-invoke just rebuilds the same canvas.
  useEffect(() => {
    let cancelled = false;
    let made: CanvasTexture | null = null;

    const paint = () => {
      // Aspect-correct canvas so a texel is roughly square on the plate; tall enough
      // to keep the `$` strokes crisp under mip-sampling at any angle.
      const width = 512;
      const height = Math.max(1, Math.round((width * label.height) / label.width));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;

      // Blue border fills the whole quad.
      context.fillStyle = label.borderColor;
      context.fillRect(0, 0, width, height);

      // Cream face inset from the border, painted as a trapezoid that tapers like the
      // plate (narrower at the TOP = canvas y=0) so the UV squeeze renders it even.
      const borderFraction = 0.12; // visible blue ring thickness as a fraction of size
      const insetX = width * borderFraction;
      const insetY = height * borderFraction;
      const faceTopHalf = (width / 2 - insetX) * label.topScale;
      const faceBottomHalf = width / 2 - insetX;
      const centerX = width / 2;
      context.fillStyle = label.faceColor;
      context.beginPath();
      context.moveTo(centerX - faceTopHalf, insetY); // top-left (narrow)
      context.lineTo(centerX + faceTopHalf, insetY); // top-right (narrow)
      context.lineTo(centerX + faceBottomHalf, height - insetY); // bottom-right (wide)
      context.lineTo(centerX - faceBottomHalf, height - insetY); // bottom-left (wide)
      context.closePath();
      context.fill();

      // "$1.00" centred on the face in the marker DISPLAY_FONT, sized to most of the
      // face height. Horizontally pre-squeezed (scale toward the narrower top average)
      // so it reads upright after the trapezoid UV stretch.
      const fontPx = Math.round((height - 2 * insetY) * 0.72);
      context.fillStyle = label.textColor;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `${fontPx}px "${DOLLAR_PLATE_FONT_FAMILY}", system-ui, sans-serif`;
      const averageTaper = (1 + label.topScale) / 2;
      context.save();
      context.translate(centerX, height / 2);
      context.scale(averageTaper, 1);
      context.fillText('$1.00', 0, 0);
      context.restore();

      made = new CanvasTexture(canvas);
      made.colorSpace = SRGBColorSpace;
      made.minFilter = LinearFilter;
      made.magFilter = LinearFilter;
      made.needsUpdate = true;
      if (!cancelled) setTexture(made);
    };

    const fontFace = new FontFace(DOLLAR_PLATE_FONT_FAMILY, `url(${DISPLAY_FONT})`);
    fontFace
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        if (!cancelled) paint();
      })
      // If the font fails to load, still paint (system fallback) rather than show nothing.
      .catch(() => {
        if (!cancelled) paint();
      });

    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [label]);

  return texture;
}

/** Private FontFace family for the baked $1.00 sticker (the marker DISPLAY_FONT). */
const DOLLAR_PLATE_FONT_FAMILY = 'HandleDollarPlateMarker';

/**
 * A faint scratch/scuff roughness map so the polished chrome (bezel, rails, pull
 * tab, plate) reads as worn metal rather than mirror-smooth plastic. Roughness
 * map => NO sRGB colorSpace.
 */
function useChromeScratches(): CanvasTexture | null {
  return useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.fillStyle = '#3a3a3a';
    context.fillRect(0, 0, size, size);

    for (let index = 0; index < 120; index += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const length = 6 + Math.random() * 40;
      const angle = Math.random() * Math.PI;
      context.strokeStyle = `rgba(180,180,180,${0.05 + Math.random() * 0.12})`;
      context.lineWidth = 0.5 + Math.random() * 0.8;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      context.stroke();
    }
    for (let index = 0; index < 30; index += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const radius = 1 + Math.random() * 3;
      context.fillStyle = `rgba(200,200,200,${0.08 + Math.random() * 0.12})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    const texture = new CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.needsUpdate = true;
    return texture;
  }, []);
}

/**
 * A HAMMERED cast-metal finish for the tongue slab: a fine-pebble height field
 * (dense small bumps, like the orange-peel/hammered texture on the real ESD
 * tongue) drives BOTH a roughness map and a matching tangent-space normal map, so
 * the slab catches light unevenly across its surface instead of reading as flat
 * chrome. Mirrors `useMetalNoise` in CabinetBody.tsx but tuned denser/finer.
 */
function useHammeredMetal(): {
  roughnessMap: CanvasTexture | null;
  normalMap: DataTexture | null;
} {
  return useMemo(() => {
    const size = 256;
    const height = new Float32Array(size * size);
    for (let i = 0; i < height.length; i += 1) height[i] = 0.5;

    // Dense small hammer dimples (the pebbled finish): many small radial bumps.
    for (let b = 0; b < 520; b += 1) {
      const cx = Math.random() * size;
      const cy = Math.random() * size;
      const radius = 3 + Math.random() * 8;
      const peak = (Math.random() - 0.5) * 0.6;
      const minX = Math.max(0, Math.floor(cx - radius));
      const maxX = Math.min(size - 1, Math.ceil(cx + radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxY = Math.min(size - 1, Math.ceil(cy + radius));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > radius) continue;
          const falloff = 1 - d / radius;
          height[y * size + x] += peak * falloff * falloff;
        }
      }
    }
    // Fine speckle on top.
    for (let i = 0; i < height.length; i += 1) {
      height[i] += (Math.random() - 0.5) * 0.12;
      if (height[i] < 0) height[i] = 0;
      if (height[i] > 1) height[i] = 1;
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    let roughnessMap: CanvasTexture | null = null;
    if (context) {
      const image = context.createImageData(size, size);
      for (let i = 0; i < height.length; i += 1) {
        // Hammered metal stays fairly glossy; vary roughness modestly around ~0.3.
        const r = Math.round(255 * (0.2 + (1 - height[i]) * 0.25));
        image.data[i * 4] = r;
        image.data[i * 4 + 1] = r;
        image.data[i * 4 + 2] = r;
        image.data[i * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      roughnessMap = new CanvasTexture(canvas);
      roughnessMap.wrapS = roughnessMap.wrapT = RepeatWrapping;
      roughnessMap.repeat.set(3, 3);
      roughnessMap.needsUpdate = true;
    }

    const normalData = new Uint8Array(size * size * 4);
    const at = (x: number, y: number) =>
      height[((y + size) % size) * size + ((x + size) % size)];
    const strength = 2.6;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dzdx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dzdy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const nx = -dzdx;
        const ny = -dzdy;
        const nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const idx = (y * size + x) * 4;
        normalData[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
        normalData[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
        normalData[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
        normalData[idx + 3] = 255;
      }
    }
    const normalMap = new DataTexture(normalData, size, size, RGBAFormat);
    normalMap.wrapS = normalMap.wrapT = RepeatWrapping;
    normalMap.repeat.set(3, 3);
    normalMap.needsUpdate = true;

    return { roughnessMap, normalMap };
  }, []);
}
