import type { SurfaceField } from './field';

type Rgb = [number, number, number];

// GL cubemap face bases, straight from the spec's (sc, tc) axes — the
// same table the deck baker uses, so textureCube reads these faces
// back in the orientation they were written.
const FACES: Array<[Rgb, Rgb, Rgb]> = [
  [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, 0, 1], [1, 0, 0], [0, -1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],
];

/**
 * The distant view of a solid world, sampled from the same field the
 * streamed terrain walks on: RGBA cube faces with sqrt-encoded ground
 * color and the flooded (sea or magma) fraction in alpha. What orbit
 * shows and what the surface delivers are one world by construction.
 */
export function bakeSurfaceCube(
  field: SurfaceField,
  size: number,
  oceanColor: Rgb,
): Uint8Array[] {
  const texelRad = 1.5708 / size;
  const seaLevelM = field.seaLevelM;
  const flooded = seaLevelM > -1e8;
  const molten = field.params.magmaCoverage > 0;
  const faces: Uint8Array[] = [];
  const heights = new Float32Array(size * size);
  const dir = { x: 0, y: 0, z: 0 };

  for (let face = 0; face < 6; face++) {
    const [forward, right, up] = FACES[face];
    const texelAt = (i: number, j: number) => {
      const u = ((i + 0.5) / size) * 2 - 1;
      const v = ((j + 0.5) / size) * 2 - 1;
      const x = forward[0] + u * right[0] + v * up[0];
      const y = forward[1] + u * right[1] + v * up[1];
      const z = forward[2] + u * right[2] + v * up[2];
      const len = Math.hypot(x, y, z);
      dir.x = x / len;
      dir.y = y / len;
      dir.z = z / len;
    };

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        texelAt(i, j);
        heights[j * size + i] = field.heightAt(dir, texelRad);
      }
    }

    const pixels = new Uint8Array(size * size * 4);
    const texelM = texelRad * field.params.radiusM;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const index = j * size + i;
        const h = heights[index];
        // Slope from grid neighbors (clamped at face edges: the seam
        // costs only a texel of rock-exposure shading).
        const hx0 = heights[j * size + Math.max(i - 1, 0)];
        const hx1 = heights[j * size + Math.min(i + 1, size - 1)];
        const hy0 = heights[Math.max(j - 1, 0) * size + i];
        const hy1 = heights[Math.min(j + 1, size - 1) * size + i];
        const grad = Math.hypot(hx1 - hx0, hy1 - hy0) / (2 * texelM);
        const slopeCos = 1 / Math.sqrt(1 + grad * grad);

        texelAt(i, j);
        let color = field.colorAt(dir, h, slopeCos, texelRad);
        let alpha = 0;
        if (flooded) {
          // Coastline antialiasing: the blend window tracks the local
          // height swing per texel, so shorelines resolve instead of
          // stair-stepping.
          const window = Math.max(6, Math.abs(hx1 - hx0) + Math.abs(hy1 - hy0));
          const t = (seaLevelM - h) / window + 0.5;
          alpha = field.params.fullyMolten
            ? 1
            : t <= 0
              ? 0
              : t >= 1
                ? 1
                : t * t * (3 - 2 * t);
          if (alpha > 0 && !molten) {
            color = [
              color[0] + (oceanColor[0] - color[0]) * alpha,
              color[1] + (oceanColor[1] - color[1]) * alpha,
              color[2] + (oceanColor[2] - color[2]) * alpha,
            ];
          }
        }
        pixels[index * 4] = Math.sqrt(Math.min(1, Math.max(0, color[0]))) * 255;
        pixels[index * 4 + 1] = Math.sqrt(Math.min(1, Math.max(0, color[1]))) * 255;
        pixels[index * 4 + 2] = Math.sqrt(Math.min(1, Math.max(0, color[2]))) * 255;
        pixels[index * 4 + 3] = alpha * 255;
      }
    }
    faces.push(pixels);
  }
  return faces;
}
