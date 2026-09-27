import { useEffect, useMemo } from 'react';
import { BoxGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { bookWallLayout, bookstore, floor } from '../../lib/dimensions';
import { mergeStaticParts, type StaticPart } from '../../lib/mergeStatic';

/**
 * The cozy indie-bookstore set the machine stands in: a warm honey-wood plank FLOOR
 * (this slice) plus — added next — a cream back wall and a bookshelf of colorful book
 * spines. Built as real geometry (lit by the explicit warm lights + reflections-only
 * HDRI) so the machine reads as standing in a little bookshop corner rather than
 * floating in a photo panorama.
 *
 * OWNED BY: this backdrop part. It does NOT build the machine; all tunable numbers
 * live in ../../lib/dimensions.ts (`bookstore`, `floor`).
 */

/**
 * A procedural WOOD-PLANK texture for the floor: long planks running FRONT-TO-BACK
 * (toward the camera) with soft darker seam lines, gentle per-plank tone shifts, and
 * fine lengthwise grain. Subtle on purpose — the machine is the subject and slice 4's
 * depth-of-field softens the floor further. Same canvas-texture approach as
 * CabinetBody's metal noise, kept here because only the floor uses it.
 */
function useWoodPlankTexture(): CanvasTexture | null {
  return useMemo(() => {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;

    // Base honey wood.
    context.fillStyle = bookstore.floor.color;
    context.fillRect(0, 0, size, size);

    // Planks run vertically in texture space (V = front-to-back once the plane is laid
    // flat with the texture rotated to point at the camera). A handful of plank columns
    // across the width, each given a slight independent tone so the floor isn't a flat
    // slab. Deterministic pseudo-random (seeded) so the look is stable across reloads.
    const plankCount = 7;
    const plankWidth = size / plankCount;
    let seed = 1337;
    const rand = () => {
      // Mulberry32 — deterministic, no Date/Math.random surprises.
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let plank = 0; plank < plankCount; plank += 1) {
      const x = plank * plankWidth;
      // Per-plank tone shift (a little lighter/darker than the base honey).
      const tone = Math.round((rand() - 0.5) * 26);
      context.fillStyle = `rgb(${176 + tone}, ${122 + tone}, ${68 + tone})`;
      context.fillRect(x, 0, plankWidth, size);

      // Fine lengthwise grain streaks within the plank.
      const streaks = 40;
      for (let s = 0; s < streaks; s += 1) {
        const gx = x + rand() * plankWidth;
        const alpha = 0.04 + rand() * 0.06;
        context.strokeStyle = `rgba(80, 50, 24, ${alpha})`;
        context.lineWidth = 1 + rand() * 1.5;
        context.beginPath();
        context.moveTo(gx, 0);
        // Slight wander so grain isn't ruler-straight.
        context.bezierCurveTo(
          gx + (rand() - 0.5) * 6, size * 0.33,
          gx + (rand() - 0.5) * 6, size * 0.66,
          gx + (rand() - 0.5) * 4, size,
        );
        context.stroke();
      }

      // Dark seam line on the plank's right edge (the gap between boards).
      context.fillStyle = 'rgba(40, 24, 10, 0.55)';
      context.fillRect(x + plankWidth - 1.5, 0, 2.5, size);
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    // Repeat along the run (V) so planks read as a series of boards down the length,
    // not one giant 6m board. ~2.5 plank-lengths across the visible floor.
    texture.repeat.set(1, 3);
    texture.needsUpdate = true;
    return texture;
  }, []);
}

/** The warm honey-wood plank floor. Sits a hair BELOW `floor.y` (the base-contact
 *  plane) so the pedestal's dome base RESTS on it with no coplanar z-fighting — the
 *  base underside is exactly at floor.y, and a coplanar floor flickers and reads as a
 *  flat disc. */
const FLOOR_Z_FIGHT_DROP = 0.002;

/**
 * The whole wall of books as TWO static meshes: every plank + bracket in one (they
 * share the wood material, differing only in colour), every book in the other. Built
 * once from the deterministic layout. This was 56 separate plank/bracket meshes plus a
 * drei <Instances> of ~400 books — which re-uploads every instance matrix every frame
 * — so the wall alone was ~60 draw calls (twice, with the shadow pass) and a per-frame
 * CPU loop, for geometry that never moves.
 */
function useBookWallGeometry() {
  const geometries = useMemo(() => {
    const { wall, shelving } = bookstore;
    const layout = bookWallLayout();

    const shelves: StaticPart[] = [];
    for (const plank of layout.planks) {
      // Full-width shelf plank, just in front of the wall.
      shelves.push({
        geometry: new BoxGeometry(shelving.spanWidth, shelving.plankThickness, shelving.plankDepth),
        position: [0, plank.centerY, shelving.plankZ],
        color: shelving.woodColor,
      });
      // Small mounting brackets bridging the plank back to the wall, a few evenly
      // spaced across the span, so the shelf reads as mounted (not floating).
      for (let bracketIndex = 0; bracketIndex < shelving.bracket.perPlank; bracketIndex += 1) {
        // Evenly space brackets across the span (perPlank is fixed ≥2 in the SoT).
        const t = bracketIndex / (shelving.bracket.perPlank - 1);
        shelves.push({
          geometry: new BoxGeometry(
            shelving.bracket.width,
            shelving.bracket.height,
            Math.abs(shelving.plankZ - wall.z),
          ),
          position: [
            (t - 0.5) * (shelving.spanWidth - shelving.bracket.width),
            // Sit the bracket BEHIND the plank (between plank and wall), just under it.
            plank.centerY - shelving.plankThickness / 2 - shelving.bracket.height / 2,
            (shelving.plankZ + wall.z) / 2,
          ],
          color: shelving.bracket.color,
        });
      }
    }

    // Unit boxes scaled per book; rotation handles leaning spines + laid-flat stacks.
    const books: StaticPart[] = layout.books.map((book) => ({
      geometry: new BoxGeometry(),
      position: book.position,
      scale: book.scale,
      rotation: [0, 0, book.rotationZ],
      color: book.color,
    }));

    return { shelves: mergeStaticParts(shelves), books: mergeStaticParts(books) };
  }, []);

  useEffect(
    () => () => {
      geometries.shelves.dispose();
      geometries.books.dispose();
    },
    [geometries],
  );
  return geometries;
}

export function BookstoreBackdrop() {
  const woodTexture = useWoodPlankTexture();
  const { wall, shelving } = bookstore;
  const bookWall = useBookWallGeometry();

  return (
    <group>
      {/* Honey-wood plank floor (large, fills the frame; receives the grounding
          shadow). Rotated -90° about X to lie flat: the plane's local V axis then maps
          to world Z (toward the camera), so the planks — which run along V in texture
          space — run front-to-back toward the viewer. */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, floor.y - FLOOR_Z_FIGHT_DROP, 0]}
        receiveShadow
      >
        <planeGeometry args={[bookstore.floor.size, bookstore.floor.size]} />
        <meshStandardMaterial
          map={woodTexture ?? undefined}
          color={woodTexture ? '#ffffff' : bookstore.floor.color}
          roughness={bookstore.floor.roughness}
          metalness={bookstore.floor.metalness}
        />
      </mesh>

      {/* Cream warm-white back wall behind the machine + book wall, receiving the soft
          cast shadow so the room reads as a real corner, not a flat card. */}
      <mesh position={[0, wall.centerY, wall.z]} receiveShadow>
        <planeGeometry args={[wall.width, wall.height]} />
        <meshStandardMaterial
          color={wall.color}
          roughness={wall.roughness}
          metalness={wall.metalness}
        />
      </mesh>

      {/* WALL OF BOOKS: full-width mounted shelf planks + their brackets (one mesh)
          and the procedurally-arranged books standing on them (one mesh). */}
      <mesh geometry={bookWall.shelves} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={shelving.woodRoughness} />
      </mesh>
      <mesh geometry={bookWall.books} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={shelving.book.roughness} />
      </mesh>
    </group>
  );
}
