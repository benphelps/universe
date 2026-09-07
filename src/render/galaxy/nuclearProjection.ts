/** A bounded tile in drawing-buffer pixels. Near-plane intersections
 * can expand to the viewport, never beyond the fixed allocation cap. */
export const NUCLEAR_TARGET_LIMIT = 1024;
export interface NuclearTile { x: number; y: number; width: number; height: number; targetWidth: number; targetHeight: number }
export function nuclearTile(view: readonly [number, number, number], radius: number,
  width: number, height: number, projectionX: number, projectionY: number): NuclearTile | null {
  const [x, y, z] = view, depth = -z;
  if (depth < -radius) return null;
  let left = 0, bottom = 0, right = width, top = height;
  if (depth > radius) {
    // Project the enclosing AABB conservatively at its near/far faces.
    const xs = [(x-radius)/(depth-radius), (x+radius)/(depth-radius), (x-radius)/(depth+radius), (x+radius)/(depth+radius)];
    const ys = [(y-radius)/(depth-radius), (y+radius)/(depth-radius), (y-radius)/(depth+radius), (y+radius)/(depth+radius)];
    left = Math.max(0, Math.floor((1 + Math.min(...xs) * projectionX) * width / 2) - 3);
    right = Math.min(width, Math.ceil((1 + Math.max(...xs) * projectionX) * width / 2) + 3);
    bottom = Math.max(0, Math.floor((1 + Math.min(...ys) * projectionY) * height / 2) - 3);
    top = Math.min(height, Math.ceil((1 + Math.max(...ys) * projectionY) * height / 2) + 3);
  }
  if (right <= left || top <= bottom) return null;
  const w = right - left, h = top - bottom;
  // Preserve aspect and a common angular sample pitch on both axes.
  const scale = Math.min(1, NUCLEAR_TARGET_LIMIT / Math.max(w, h));
  return {x:left, y:bottom, width:w, height:h, targetWidth:Math.max(1,Math.ceil(w*scale)), targetHeight:Math.max(1,Math.ceil(h*scale))};
}

/** Cubic B-spline: its four discrete pixel samples sum to one for any
 * subpixel phase. Unlike alpha-sized sprites, overlap simply adds flux. */
export function nuclearPointKernel(x: number): number {
  const a = Math.abs(x);
  return a < 1 ? 2/3 - a*a + .5*a*a*a : a < 2 ? (2-a)**3/6 : 0;
}
