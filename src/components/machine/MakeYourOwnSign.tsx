import { useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Text } from '../SceneText';
import { DISPLAY_FONT, LABEL_FONT, frame, sign } from '../../lib/dimensions';

/**
 * The way into the builder, as an object in the shop instead of a button over it: a
 * cream tent card standing on top of the cabinet (geometry in dimensions.ts `sign`).
 *
 * Lettering sticks to characters the two bundled fonts carry. Anything else (an
 * arrow glyph, say) makes troika fetch a fallback font from a CDN, which is both a
 * flash of missing text and a third-party request the page otherwise never makes.
 *
 * Hover only changes props (scale + cursor), and a prop change already asks the
 * on-demand canvas for a frame, so there is no useFrame here.
 */
export function MakeYourOwnSign({ onOpen }: { onOpen: () => void }) {
  const [hovered, setHovered] = useState(false);
  const scale = hovered ? sign.hoverScale : 1;
  const faceZ = sign.thickness / 2 + 0.0004;
  // Both panels meet at the top edge: the front one leans back, the prop leans forward.
  const propZ = -2 * Math.sin(sign.lean) * sign.height;

  return (
    <group position={[sign.x, sign.y, sign.z]} rotation={[0, sign.yaw, 0]} scale={scale}>
      <group rotation={[-sign.lean, 0, 0]}>
        <mesh
          position={[0, sign.height / 2, 0]}
          castShadow
          onClick={(event: ThreeEvent<MouseEvent>) => {
            event.stopPropagation();
            onOpen();
          }}
          onPointerOver={(event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            document.body.style.cursor = 'pointer';
            setHovered(true);
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
            setHovered(false);
          }}
        >
          <boxGeometry args={[sign.width, sign.height, sign.thickness]} />
          <meshStandardMaterial color={sign.color} roughness={0.92} />
        </mesh>

        {/* Text and sticker never take the pointer, so the whole card is one target. */}
        <group position={[0, sign.height / 2, faceZ]}>
          <mesh position={[-sign.width / 2 + sign.badgeRadius + 0.008, 0, 0]} raycast={() => null}>
            <circleGeometry args={[sign.badgeRadius, 32]} />
            <meshStandardMaterial color={frame.color} roughness={0.6} />
          </mesh>
          <Text
            position={[-sign.width / 2 + sign.badgeRadius + 0.008, 0.0004, 0.0003]}
            fontSize={sign.badgeRadius * 1.7}
            font={DISPLAY_FONT}
            anchorX="center"
            anchorY="middle"
            color="#fff7ec"
            raycast={() => null}
          >
            +
          </Text>
          <Text
            position={[sign.badgeRadius + 0.002, 0.0085, 0]}
            fontSize={sign.titleSize}
            font={DISPLAY_FONT}
            letterSpacing={0.02}
            anchorX="center"
            anchorY="middle"
            color={sign.inkColor}
            raycast={() => null}
          >
            MAKE YOUR OWN
          </Text>
          <Text
            position={[sign.badgeRadius + 0.002, -0.0118, 0]}
            fontSize={sign.noteSize}
            font={LABEL_FONT}
            anchorX="center"
            anchorY="middle"
            color={sign.inkColor}
            raycast={() => null}
          >
            with your own photos
          </Text>
        </group>
      </group>

      <group position={[0, 0, propZ]} rotation={[sign.lean, 0, 0]}>
        <mesh position={[0, sign.height / 2, 0]} castShadow raycast={() => null}>
          <boxGeometry args={[sign.width, sign.height, sign.thickness]} />
          <meshStandardMaterial color={sign.color} roughness={0.92} />
        </mesh>
      </group>
    </group>
  );
}
