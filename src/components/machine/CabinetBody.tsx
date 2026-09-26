import { RoundedBox } from '@react-three/drei';
import { useMemo } from 'react';
import {
  BufferAttribute,
  CanvasTexture,
  DataTexture,
  LatheGeometry,
  RepeatWrapping,
  RGBAFormat,
  Vector2,
} from 'three';
import {
  cabinet,
  cabinetGeometry,
  card,
  cardSlit,
  face,
  frame,
  glass,
  handle,
  lowerPanel,
  pedestal,
  slotX,
  upperPanel,
} from '../../lib/dimensions';
import { slotOrder } from '../../data/celebration';

/**
 * The vending-machine BODY: ONE continuous deep red shell (body + front rim are
 * the same RoundedBox, same corner radius — no separate frame piece, no seam).
 * The front face has a RECESSED white opening; the red border around it is the
 * shell's own front. A chrome-framed glass pane stands proud over the UPPER
 * print-display area only (the lower handle band has no glass). Four proud corner
 * caps, a brass latch, and the glossy black pole + trumpet dome base.
 *
 * OWNED BY: cabinet-body part. Matches reference-images/compressed/ref-00 (full
 * body) and ref-02 (front). It does NOT build the prints, handles, text, or coin
 * mechanisms. All tunable numbers live in ../../lib/dimensions.ts.
 */

/**
 * A NOISY painted-metal finish: a single height field (low-frequency enamel
 * blotches + fine orange-peel speckle) drives BOTH a roughness map and a matching
 * normal map, so the red frame reads as worn enamel-over-steel with a visibly
 * uneven, light-catching surface (ref-01) rather than flat paint.
 */
function useMetalNoise(repeat: number): {
  roughnessMap: CanvasTexture | null;
  normalMap: DataTexture | null;
} {
  return useMemo(() => {
    const size = 256;
    // Build a grayscale HEIGHT field.
    const height = new Float32Array(size * size);
    for (let i = 0; i < height.length; i += 1) height[i] = 0.5;

    // Low-frequency enamel blotches (soft radial bumps).
    for (let b = 0; b < 90; b += 1) {
      const cx = Math.random() * size;
      const cy = Math.random() * size;
      const radius = 12 + Math.random() * 46;
      const peak = (Math.random() - 0.5) * 0.5;
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
    // Fine orange-peel speckle (high frequency).
    for (let i = 0; i < height.length; i += 1) {
      height[i] += (Math.random() - 0.5) * 0.22;
      if (height[i] < 0) height[i] = 0;
      if (height[i] > 1) height[i] = 1;
    }

    // Roughness map: higher (rougher) where the height dips (worn pits), so the
    // gloss varies across the surface. Drawn into a canvas.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    let roughnessMap: CanvasTexture | null = null;
    if (context) {
      const image = context.createImageData(size, size);
      for (let i = 0; i < height.length; i += 1) {
        // Map height -> roughness around ~0.5 with strong variation.
        const r = Math.round(255 * (0.35 + (1 - height[i]) * 0.4));
        image.data[i * 4] = r;
        image.data[i * 4 + 1] = r;
        image.data[i * 4 + 2] = r;
        image.data[i * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      roughnessMap = new CanvasTexture(canvas);
      roughnessMap.wrapS = roughnessMap.wrapT = RepeatWrapping;
      roughnessMap.repeat.set(repeat, repeat);
      roughnessMap.needsUpdate = true;
    }

    // Normal map: Sobel of the height field -> RGBA normals, tangent space.
    const normalData = new Uint8Array(size * size * 4);
    const at = (x: number, y: number) =>
      height[((y + size) % size) * size + ((x + size) % size)];
    const strength = 2.2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dzdx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dzdy = (at(x, y + 1) - at(x, y - 1)) * strength;
        // Normal = normalize(-dzdx, -dzdy, 1).
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
    normalMap.repeat.set(repeat, repeat);
    normalMap.needsUpdate = true;

    return { roughnessMap, normalMap };
  }, [repeat]);
}

export function CabinetBody() {
  // Fine noise for the red enamel (high repeat = small grain) and the black POLE.
  // The dome BASE stays smooth — its lathe UVs spread the noise into glittery
  // static, so only the cylindrical pole gets the noise maps.
  const redNoise = useMetalNoise(4);
  const blackNoise = useMetalNoise(3);
  const cap = frame.cornerCap;

  // Swept trumpet/dome base, lathed from the dimensions profile. LatheGeometry's
  // default UVs run (angle, profile) which SMEAR a tiling noise into radial static
  // at the disc. Recompute UVs as a top-down PLANAR projection (XZ → uv) so the
  // metal grain maps evenly across the surface like a real disc.
  const baseGeometry = useMemo(() => {
    const points = pedestal.baseProfile.map((point) => new Vector2(point.radius, point.y));
    const geometry = new LatheGeometry(points, 96);
    const position = geometry.attributes.position;
    const maxRadius = Math.max(...pedestal.baseProfile.map((p) => p.radius)) || 1;
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i += 1) {
      // Map world XZ into [0,1] (scaled so the grain repeats a few times).
      uv[i * 2] = (position.getX(i) / (2 * maxRadius)) * 3 + 0.5;
      uv[i * 2 + 1] = (position.getZ(i) / (2 * maxRadius)) * 3 + 0.5;
    }
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    return geometry;
  }, []);

  const baseY = pedestal.cabinetBottomY - pedestal.poleHeight;
  const poleCenterY = pedestal.cabinetBottomY - pedestal.poleHeight / 2;

  // Worn red enamel over steel: noisy roughness + matching normal map for the
  // visibly uneven, light-catching finish (ref-01), under a thin clearcoat.
  const redMaterialProps = {
    color: frame.color,
    roughness: 0.6,
    metalness: 0.2,
    roughnessMap: redNoise.roughnessMap,
    normalMap: redNoise.normalMap,
    normalScale: new Vector2(0.4, 0.4),
    // Softer satin clearcoat (a full-gloss coat catches harsh white hotspots).
    clearcoat: 0.5,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.5,
  };
  const darkRedMaterialProps = {
    ...redMaterialProps,
    color: frame.colorDark,
    roughness: 0.52,
  };
  const chromeMaterialProps = {
    color: glass.chromeFrame.color,
    roughness: 0.25,
    metalness: 1,
    envMapIntensity: 0.7,
  };
  // Glossy black metal pole + base: reflective with subtle grain. SAME noise maps
  // on both; the base geometry below gets PLANAR (top-down XZ) UVs so the noise
  // tiles evenly across the disc instead of smearing in along the lathe's radial
  // UVs (that was the bug — wrong UVs, not the texture).
  const blackPoleProps = {
    color: pedestal.color,
    roughness: 0.28,
    metalness: 0.7,
    roughnessMap: blackNoise.roughnessMap,
    normalMap: blackNoise.normalMap,
    normalScale: new Vector2(0.22, 0.22),
    envMapIntensity: 1,
  };
  const blackBaseProps = blackPoleProps;

  // Chrome frame rails around the UPPER glass only. Pulled back so the rail
  // front edge stays BEHIND the proud corner caps (caps tuck on top, no z-fight).
  const glassHalfW = glass.width / 2;
  const glassHalfH = glass.height / 2;
  const chromeZ = glass.z - glass.chromeFrame.depth / 2 - 0.002;

  return (
    <group>
      {/* ONE continuous deep red shell (body + front rim, single RoundedBox). */}
      <RoundedBox
        args={[cabinet.width, cabinet.height, cabinet.depth]}
        radius={cabinet.cornerRadius}
        smoothness={5}
        position={[0, 0, cabinetGeometry.centerZ]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial {...redMaterialProps} />
      </RoundedBox>

      {/* White opening face: a thin panel set into the front, flush-proud of the
          red front so the red reads only as the border rim around it. */}
      <mesh position={[0, 0, face.z - 0.006]} receiveShadow>
        <boxGeometry args={[face.width, face.height, 0.013]} />
        <meshStandardMaterial color={face.color} roughness={0.85} metalness={0.02} />
      </mesh>

      {/* Faint seam between the upper print panel and the lower handle band. */}
      <mesh position={[0, (upperPanel.centerY - upperPanel.height / 2 + lowerPanel.centerY + lowerPanel.height / 2) / 2, face.z + 0.0006]}>
        <planeGeometry args={[face.width, 0.0016]} />
        <meshStandardMaterial color="#d7d4cc" roughness={0.9} />
      </mesh>

      {/* Horizontal card-emerge SLITS in the face, one just ABOVE each handle.
          The kraft sleeve + print slide out flat through these (ref-01/04/06). */}
      {slotOrder.map((slot) => (
        <mesh
          key={`slit-${slot}`}
          position={[slotX[slot], handle.centerY + card.slitLocalY, face.z - 0.002]}
        >
          <boxGeometry args={[cardSlit.width, cardSlit.height, cardSlit.depth]} />
          <meshStandardMaterial color={cardSlit.color} roughness={0.85} metalness={0.1} />
        </mesh>
      ))}

      {/* Chrome frame rails around the UPPER glass only. */}
      <mesh position={[0, glass.centerY + glassHalfH, chromeZ]} castShadow>
        <boxGeometry args={[glass.width + glass.chromeFrame.thickness, glass.chromeFrame.thickness, glass.chromeFrame.depth]} />
        <meshStandardMaterial {...chromeMaterialProps} />
      </mesh>
      <mesh position={[0, glass.centerY - glassHalfH, chromeZ]} castShadow>
        <boxGeometry args={[glass.width + glass.chromeFrame.thickness, glass.chromeFrame.thickness, glass.chromeFrame.depth]} />
        <meshStandardMaterial {...chromeMaterialProps} />
      </mesh>
      <mesh position={[-glassHalfW, glass.centerY, chromeZ]} castShadow>
        <boxGeometry args={[glass.chromeFrame.thickness, glass.height, glass.chromeFrame.depth]} />
        <meshStandardMaterial {...chromeMaterialProps} />
      </mesh>
      <mesh position={[glassHalfW, glass.centerY, chromeZ]} castShadow>
        <boxGeometry args={[glass.chromeFrame.thickness, glass.height, glass.chromeFrame.depth]} />
        <meshStandardMaterial {...chromeMaterialProps} />
      </mesh>

      {/* The UPPER glass pane: a real display window IN FRONT of the title/grid/
          footer. A CRISP faintly-tinted transparent sheet (NOT transmission — the
          transmission buffer pixelates the fine text/thumbnails behind it).
          depthWrite off + high renderOrder so it draws over the content without
          z-fighting; the content stays sharp. */}
      <mesh position={[0, glass.centerY, glass.z - glass.depth / 2]} renderOrder={2}>
        <boxGeometry args={[glass.width, glass.height, glass.depth]} />
        <meshPhysicalMaterial
          color={glass.color}
          transparent
          opacity={0.16}
          roughness={0.04}
          metalness={0}
          transmission={0}
          ior={1.45}
          depthWrite={false}
          envMapIntensity={1}
        />
      </mesh>

      {/* Brass latch knob centred on the top rim. */}
      <mesh
        position={[0, cabinet.height / 2 + frame.latch.height / 2 - 0.004, cabinet.faceZ - 0.006]}
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[frame.latch.radius, frame.latch.radius * 1.1, frame.latch.height, 20]} />
        <meshStandardMaterial color={frame.latch.color} roughness={0.32} metalness={0.85} />
      </mesh>

      {/* Four PROUD angled red corner caps standing above the front rim. */}
      {(
        [
          { key: 'tl', x: -cap.x, y: cap.y, tilt: cap.topTilt },
          { key: 'tr', x: cap.x, y: cap.y, tilt: -cap.topTilt },
          { key: 'bl', x: -cap.x, y: -cap.y, tilt: cap.bottomTilt },
          { key: 'br', x: cap.x, y: -cap.y, tilt: -cap.bottomTilt },
        ] as const
      ).map((spec) => (
        <RoundedBox
          key={`cap-${spec.key}`}
          args={[cap.width, cap.height, cap.depth]}
          radius={0.004}
          smoothness={3}
          position={[spec.x, spec.y, cap.frontZ - cap.depth / 2]}
          rotation={[0, 0, spec.tilt]}
          castShadow
          receiveShadow
        >
          <meshPhysicalMaterial {...darkRedMaterialProps} />
        </RoundedBox>
      ))}

      {/* Glossy-but-worn black pole. */}
      <mesh position={[0, poleCenterY, cabinetGeometry.centerZ]} castShadow receiveShadow>
        <cylinderGeometry
          args={[pedestal.poleRadius, pedestal.poleRadius * 1.06, pedestal.poleHeight, 64]}
        />
        <meshStandardMaterial {...blackPoleProps} />
      </mesh>

      {/* Wide trumpet/dome disc base, swept from the profile (smooth — no noise). */}
      <mesh geometry={baseGeometry} position={[0, baseY, cabinetGeometry.centerZ]} castShadow receiveShadow>
        <meshStandardMaterial {...blackBaseProps} />
      </mesh>
    </group>
  );
}
