import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls, ContactShadows } from '@react-three/drei';
import { Suspense, type ReactNode } from 'react';

/**
 * Isolated rendering harness for developing a single machine part against its
 * reference image. Each part component is dropped in here and validated alone
 * (lit, orbitable, on a neutral backdrop) before being composed into the full
 * machine. Camera/target are tuned for a part roughly centered at the origin.
 */
export function PartHarness({
  children,
  cameraPosition = [0, 0.05, 0.45],
  target = [0, 0, 0],
  background = '#efece4',
}: {
  children: ReactNode;
  cameraPosition?: [number, number, number];
  target?: [number, number, number];
  background?: string;
}) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: cameraPosition, fov: 42 }}>
        <color attach="background" args={[background]} />
        <ambientLight intensity={1.2} />
        <directionalLight
          castShadow
          intensity={2.1}
          position={[0.4, 0.9, 0.9]}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <Environment preset="city" />
        <Suspense fallback={null}>{children}</Suspense>
        <ContactShadows position={[0, -0.16, 0]} opacity={0.4} scale={1} blur={2.2} far={0.8} />
        <OrbitControls enablePan={false} target={target} />
      </Canvas>
    </div>
  );
}
