import { Text as DreiText } from '@react-three/drei';
import { ComponentProps, forwardRef, Suspense } from 'react';

/**
 * drei's `<Text>`, behind its OWN Suspense boundary. Use this, never drei's directly.
 *
 * drei suspends every `<Text>` until troika has the glyphs, and it keys that suspense
 * on the WHOLE string (`['troika-text', font, characters]`), so any text the scene has
 * not shown before suspends — a card's title and message the first time it is pulled,
 * a thumbnail label switching from `? ? ?` to the owned title, a deck rename. Unbounded,
 * that reaches App's one Suspense around the scene, which hides EVERY object in it
 * until the font resolves: the machine vanished for a few frames on the first pull and
 * the bare cream background flashed across the whole screen. Bounded here, only the
 * new string waits.
 */
export const Text = forwardRef<unknown, ComponentProps<typeof DreiText>>(function Text(props, ref) {
  return (
    <Suspense fallback={null}>
      <DreiText ref={ref as never} {...props} />
    </Suspense>
  );
});
