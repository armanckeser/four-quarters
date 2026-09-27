import { BufferAttribute, BufferGeometry, Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * One static piece of a merged mesh: its geometry (consumed — disposed after the merge),
 * where it sits in the merged mesh's local frame, and the colour it would have had as
 * its own material's `color`.
 */
export type StaticPart = {
  geometry: BufferGeometry;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  color: string;
};

/**
 * Bakes a set of parts that share every material setting EXCEPT colour into ONE
 * geometry, with each part's colour written into a vertex-colour attribute. Rendered
 * with a single material (`vertexColors`, colour white) it looks exactly like the
 * separate meshes did — three multiplies material colour by vertex colour, and both
 * are converted to linear the same way — but it costs one draw call instead of one
 * per part, and one more for the shadow pass instead of one per part again.
 *
 * Draw calls, not triangles, are what a phone GPU driver chokes on: the handles,
 * shelving and cabinet trim were ~150 tiny meshes of a dozen triangles each.
 */
export function mergeStaticParts(parts: StaticPart[]): BufferGeometry {
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const color = new Color();

  const prepared = parts.map(({ geometry, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], color: hex }) => {
    // mergeGeometries needs every input to agree on indexing + attributes.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (flat !== geometry) geometry.dispose();
    for (const name of Object.keys(flat.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') flat.deleteAttribute(name);
    }
    flat.clearGroups();
    quaternion.setFromEuler(new Euler(...rotation));
    matrix.compose(new Vector3(...position), quaternion, new Vector3(...scale));
    flat.applyMatrix4(matrix);

    color.set(hex);
    const count = flat.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    flat.setAttribute('color', new BufferAttribute(colors, 3));
    return flat;
  });

  const merged = mergeGeometries(prepared, false);
  for (const geometry of prepared) geometry.dispose();
  if (!merged) throw new Error('mergeStaticParts: parts do not share attributes');
  merged.computeBoundingSphere();
  return merged;
}
