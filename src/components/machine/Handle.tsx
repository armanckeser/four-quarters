import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DataTexture,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  MathUtils,
  Path,
  RepeatWrapping,
  RGBAFormat,
  Shape,
  SRGBColorSpace,
  Vector2,
} from 'three';
import type { DrawerStatus } from '../../App';
import { DAMP_HANDLE, DISPLAY_FONT, handle } from '../../lib/dimensions';
import { frameDelta } from '../../lib/frameloop';
import { mergeStaticParts, type StaticPart } from '../../lib/mergeStatic';

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
  // Geometry + textures are identical for all three handles, so they are built ONCE
  // per page and shared (see handleAssets) — the CSG cuts and the noise fields used
  // to be recomputed for every handle, which was most of the scene's start-up time on
  // a phone, and tripled the texture memory.
  const {
    scratch,
    hammered,
    labelGeometry,
    tongueGeometry,
    pullTabGeometry,
    housingChrome,
    housingDark,
  } = handleAssets();
  const dollarPlate = useDollarPlateTexture();

  const { frame, inner, coinSlots, coin, label, chrome } = handle;

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

  // On-demand canvas: a status change only retargets the slide below, so ask for the
  // frame that starts it; the slide then keeps asking until it lands.
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => invalidate(), [tuckedIn, invalidate]);

  useFrame((state, rawDelta) => {
    const node = innerRef.current;
    if (!node) return;
    const targetZ = tuckedIn ? handle.zIn : handle.zOut;
    node.position.z = MathUtils.damp(node.position.z, targetZ, DAMP_HANDLE, frameDelta(rawDelta));
    if (Math.abs(node.position.z - targetZ) > 1e-5) state.invalidate();
  });

  const { slabBottomY, frameFrontZ, slotRowY, slotWorldX } = housingLayout();

  return (
    <group>
      {/* ================= STATIC FRAME BEZEL + RAIL HOUSING ================= */}
      {/* Every chrome piece that never moves — the bezel plate, its screws, the
          housing floor, side cheeks and rails — as ONE mesh (colours baked per part;
          see buildHousingGeometries). Same material as each piece had on its own. */}
      <mesh geometry={housingChrome} castShadow receiveShadow>
        <meshStandardMaterial {...chromeProps} color="#ffffff" vertexColors />
      </mesh>

      {/* The dark coin channel: each open slit (a thin dark box proud of the bezel)
          plus the snug cavity behind it, so a slot reads as a channel coins drop into,
          not a see-through gap. One mesh for all of them. */}
      <mesh geometry={housingDark}>
        <meshStandardMaterial color={coinSlots.openColor} roughness={0.9} metalness={0.05} />
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

      {/* The 5th slot (blindIndex) is a flush chrome fill (sealed). Kept out of the
          merged chrome: it needs polygonOffset to sit on the bezel face. */}
      <mesh position={[slotWorldX(coinSlots.blindIndex), slotRowY, frameFrontZ + 0.0003]}>
        <boxGeometry args={[coinSlots.width, coinSlots.length, 0.001]} />
        <meshStandardMaterial
          {...chromeProps}
          color={coinSlots.filledColor}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

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
        <meshBasicMaterial visible={false} />
      </mesh>

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
              <meshBasicMaterial visible={false} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

/**
 * Where the static pieces of a handle sit, in the handle's local frame. Shared by the
 * component (coins, hit area, tongue origin) and the merged housing geometry so the
 * two can never drift apart.
 */
function housingLayout() {
  const { frame, outer, inner, coinSlots } = handle;
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

  return {
    floorY, railTopY, wallY, wallX, railStartX, slabBottomY, frameCenterZ, frameFrontZ,
    slotRowY, slotWorldX, slotFrontZ, screwX, screwY,
  };
}

/**
 * The static housing as two merged geometries (see lib/mergeStatic):
 *   - chrome: bezel plate, two corner screws + the centre fastener, housing floor,
 *     side cheeks, rails — all the same scratched chrome, differing only in tint;
 *   - dark: the four open slits + the cavity behind each.
 */
function buildHousingGeometries(): { chrome: BufferGeometry; dark: BufferGeometry } {
  const { frame, outer, coinSlots, chrome } = handle;
  const layout = housingLayout();
  const screwGeometry = () =>
    new CylinderGeometry(frame.screw.radius, frame.screw.radius, frame.screw.length, 16);

  const chromeParts: StaticPart[] = [
    // Chrome plate bolted to the face.
    {
      geometry: new BoxGeometry(frame.width, frame.height, frame.thickness),
      position: [0, frame.centerY, layout.frameCenterZ],
      color: frame.color,
    },
    // Two corner screws + one tiny centre fastener (between the slot row and the
    // foam strip).
    ...([
      [-layout.screwX, layout.screwY],
      [layout.screwX, layout.screwY],
      [0, layout.slotRowY + coinSlots.length / 2 + frame.screw.radius * 1.5],
    ] as const).map(([sx, sy]): StaticPart => ({
      geometry: screwGeometry(),
      position: [sx, sy, layout.frameFrontZ + frame.screw.length / 2],
      rotation: [Math.PI / 2, 0, 0],
      color: frame.screw.color,
    })),
    // Rail housing: floor + two side cheeks + the front-to-back rails.
    {
      geometry: new BoxGeometry(outer.innerClearWidth + 2 * outer.wallThickness, outer.floorThickness, outer.floorDepth),
      position: [0, layout.floorY, 0],
      color: outer.color,
    },
    ...[-layout.wallX, layout.wallX].map((x): StaticPart => ({
      geometry: new BoxGeometry(outer.wallThickness, outer.wallHeight, outer.wallDepth),
      position: [x, layout.wallY, 0],
      color: outer.color,
    })),
    ...Array.from({ length: outer.rail.count }, (_, index): StaticPart => ({
      geometry: new BoxGeometry(outer.rail.width, outer.rail.height, outer.rail.depth),
      position: [layout.railStartX + index * outer.rail.pitch, layout.railTopY, 0],
      color: chrome.color,
    })),
  ];

  const darkParts: StaticPart[] = [];
  for (let index = 0; index < coinSlots.count; index += 1) {
    if (index === coinSlots.blindIndex) continue;
    // Dark cavity directly behind the open slit, snug to it (not a slab across the
    // whole bezel), set just behind the plate front so the chrome stays visible
    // around the slits.
    darkParts.push({
      geometry: new BoxGeometry(coinSlots.width + 0.0015, coinSlots.length + 0.001, 0.0016),
      position: [layout.slotWorldX(index), layout.slotRowY, layout.frameFrontZ - 0.0018],
      color: coinSlots.openColor,
    });
    // The open slit itself, proud of the bezel face.
    darkParts.push({
      geometry: new BoxGeometry(coinSlots.width, coinSlots.length, coinSlots.depth),
      position: [layout.slotWorldX(index), layout.slotRowY, layout.slotFrontZ],
      color: coinSlots.openColor,
    });
  }

  return { chrome: mergeStaticParts(chromeParts), dark: mergeStaticParts(darkParts) };
}

type HandleAssets = {
  scratch: CanvasTexture | null;
  hammered: { roughnessMap: CanvasTexture | null; normalMap: DataTexture | null };
  labelGeometry: BufferGeometry;
  tongueGeometry: BufferGeometry;
  pullTabGeometry: BufferGeometry;
  housingChrome: BufferGeometry;
  housingDark: BufferGeometry;
};

let sharedAssets: HandleAssets | null = null;

/**
 * Everything a handle draws that does not depend on its state, built on first use and
 * shared by every handle for the life of the page (never disposed: there are always
 * handles on screen, and the part harness remounts them freely).
 */
function handleAssets(): HandleAssets {
  if (sharedAssets) return sharedAssets;
  const { inner, label } = handle;

  // Trapezoid pull-tab flange (tapered like the $1.00 plate), centred on Z.
  const pullTabGeometry = buildTrapezoid(inner.pullTab.width, inner.pullTab.height, inner.pullTab.topScale, inner.pullTab.thickness);
  pullTabGeometry.translate(0, 0, -inner.pullTab.thickness / 2);
  const housing = buildHousingGeometries();

  sharedAssets = {
    scratch: makeChromeScratches(),
    hammered: makeHammeredMetal(),
    // Flat trapezoid $1.00 plate (wider at the bottom) with proper [0,1] front-face
    // UVs; the whole sticker (blue border + cream face + "$1.00") is BAKED onto its
    // map. A custom single-quad geometry — NOT buildTrapezoid's ExtrudeGeometry,
    // whose default cap UVs are raw vertex coords (~±0.015) that cluster the whole
    // face onto one blue texel.
    labelGeometry: buildLabelPlate(label.width, label.height, label.topScale),
    // The tongue: a flat slab with back cutouts that register with the frame slots.
    tongueGeometry: buildTongueGeometry(),
    pullTabGeometry,
    housingChrome: housing.chrome,
    housingDark: housing.dark,
  };
  return sharedAssets;
}

/**
 * The tongue slab geometry: a flat slab at constant thickness with FOUR slots cut
 * through it near its BACK edge that REGISTER with the frame's open coin slots (a coin
 * drops through the frame slot into the matching slab cutout; pushing the slab carries
 * it in). The blind slot (coinSlots.blindIndex) is NOT cut (sealed, matching the frame).
 *
 * Built in the slab's LOCAL frame then rendered with rotation [0,-PI/2,0]: local
 * x = front→back depth (+x = user/front end), y = height, z = part width (centred).
 *
 * The slab is the top-view outline with the cutouts as HOLES, extruded up by the slab
 * thickness. Every cutout sits `inset` inside the back edge, so the holes never touch
 * the outline and the triangulation is exact. (This used to be a box with a CSG
 * subtraction per slot — the same solid, but it pulled two BVH/CSG libraries into the
 * bundle and ran the boolean evaluator for every handle at start-up.)
 *
 * MIRRORING GOTCHA: the render rotation maps geometry-local +Z → world −X, so to land
 * cutout i at the SAME world X as frame slot i (slotWorldX(i)), it is placed at local
 * z = −slotWorldX(i).
 */
function buildTongueGeometry(): BufferGeometry {
  const { inner, coinSlots } = handle;
  const halfLength = inner.length / 2;
  const halfWidth = inner.width / 2;

  // Outline drawn in (x, w); extruding along +e and rotating −90° about X maps
  // (x, w, e) → (x, e, −w): e becomes height (y) and w becomes −z.
  const outline = new Shape();
  outline.moveTo(-halfLength, -halfWidth);
  outline.lineTo(halfLength, -halfWidth);
  outline.lineTo(halfLength, halfWidth);
  outline.lineTo(-halfLength, halfWidth);
  outline.closePath();

  // Cutout X (front→back): runs from `inset` forward of the back edge, forward by
  // backCutouts.length.
  const cutBack = -halfLength + inner.backCutouts.inset;
  const cutFront = cutBack + inner.backCutouts.length;
  const slotStartX = -((coinSlots.count - 1) / 2) * coinSlots.pitch;
  for (let index = 0; index < coinSlots.count; index += 1) {
    if (index === coinSlots.blindIndex) continue; // 5th stays solid (sealed)
    // w = +slotWorldX(i) lands at local z = −slotWorldX(i) after the rotation.
    const w = slotStartX + index * coinSlots.pitch;
    const hole = new Path();
    hole.moveTo(cutBack, w - coinSlots.width / 2);
    hole.lineTo(cutBack, w + coinSlots.width / 2);
    hole.lineTo(cutFront, w + coinSlots.width / 2);
    hole.lineTo(cutFront, w - coinSlots.width / 2);
    hole.closePath();
    outline.holes.push(hole);
  }

  const geometry = new ExtrudeGeometry(outline, {
    depth: inner.thickness,
    bevelEnabled: false,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
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
  const [texture, setTexture] = useState<CanvasTexture | null>(sharedDollarPlate);
  useEffect(() => {
    if (sharedDollarPlate) return;
    let cancelled = false;
    dollarPlatePromise ??= paintDollarPlate().then((made) => (sharedDollarPlate = made));
    dollarPlatePromise.then((made) => {
      if (!cancelled) setTexture(made);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return texture;
}

/** The baked sticker, shared by all three handles (painted once per page). */
let sharedDollarPlate: CanvasTexture | null = null;
let dollarPlatePromise: Promise<CanvasTexture | null> | null = null;

function paintDollarPlate(): Promise<CanvasTexture | null> {
  const { label } = handle;
  const paint = (): CanvasTexture | null => {
    // Aspect-correct canvas so a texel is roughly square on the plate; tall enough
    // to keep the `$` strokes crisp under mip-sampling at any angle.
    const width = 512;
    const height = Math.max(1, Math.round((width * label.height) / label.width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;

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

    const made = new CanvasTexture(canvas);
    made.colorSpace = SRGBColorSpace;
    made.minFilter = LinearFilter;
    made.magFilter = LinearFilter;
    made.needsUpdate = true;
    return made;
  };

  const fontFace = new FontFace(DOLLAR_PLATE_FONT_FAMILY, `url(${DISPLAY_FONT})`);
  return (
    fontFace
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
      })
      // If the font fails to load, still paint (system fallback) rather than show nothing.
      .catch(() => undefined)
      .then(paint)
  );
}

/** Private FontFace family for the baked $1.00 sticker (the marker DISPLAY_FONT). */
const DOLLAR_PLATE_FONT_FAMILY = 'HandleDollarPlateMarker';

/**
 * A faint scratch/scuff roughness map so the polished chrome (bezel, rails, pull
 * tab, plate) reads as worn metal rather than mirror-smooth plastic. Roughness
 * map => NO sRGB colorSpace.
 */
function makeChromeScratches(): CanvasTexture | null {
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
}

/**
 * A HAMMERED cast-metal finish for the tongue slab: a fine-pebble height field
 * (dense small bumps, like the orange-peel/hammered texture on the real ESD
 * tongue) drives BOTH a roughness map and a matching tangent-space normal map, so
 * the slab catches light unevenly across its surface instead of reading as flat
 * chrome. Mirrors `useMetalNoise` in CabinetBody.tsx but tuned denser/finer.
 */
function makeHammeredMetal(): {
  roughnessMap: CanvasTexture | null;
  normalMap: DataTexture | null;
} {
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
}
