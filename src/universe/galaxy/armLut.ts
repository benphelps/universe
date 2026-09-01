import { armProfile } from './density';

/**
 * The arm profile baked onto a polar grid, for the renderers that ask
 * it tens of millions of times a frame.
 *
 * armProfile is a pure function of disk position, fixed per galaxy —
 * but each evaluation solves the orbit family twice, and the volume
 * march was spending most of its frame re-solving it per step per
 * pixel. Baked once from the model itself, the march reads a texture
 * and the model stays the only implementation — the shader mirror this
 * replaces had already drifted, carrying the prime galaxy's modulation
 * constants into every derived galaxy.
 *
 * Azimuth runs across (wrapping), log radius runs down (clamped): log
 * spacing gives the inner arms the same texel footprint as the rim.
 */
export const ARM_LUT_SIZE = 512;
/** Radial window, pc: the wave's own inner cutoff out to the volume
 *  march's bounding sphere. armProfile is zero at both edges, so the
 *  lookup's clamp rows hold zeros and reads outside stay honest. */
export const ARM_LUT_RADIUS_MIN_PC = 500;
export const ARM_LUT_RADIUS_MAX_PC = 33000;

const LOG_SPAN = Math.log(ARM_LUT_RADIUS_MAX_PC / ARM_LUT_RADIUS_MIN_PC);

/** Radius at a row's texel centre, pc. */
export function armLutRadiusPc(row: number): number {
  return ARM_LUT_RADIUS_MIN_PC * Math.exp(((row + 0.5) / ARM_LUT_SIZE) * LOG_SPAN);
}

/** Azimuth at a column's texel centre, rad. */
export function armLutAzimuthRad(col: number): number {
  return ((col + 0.5) / ARM_LUT_SIZE) * 2 * Math.PI;
}

/**
 * The bake: interleaved (boost, lane) pairs, azimuth-major within each
 * radius row — the layout of an RG texture. A few hundred milliseconds
 * of orbit-family inversions, which is why it runs in a worker.
 */
export function bakeArmLut(): Float32Array {
  const out = new Float32Array(ARM_LUT_SIZE * ARM_LUT_SIZE * 2);
  for (let row = 0; row < ARM_LUT_SIZE; row++) {
    const radiusPc = armLutRadiusPc(row);
    for (let col = 0; col < ARM_LUT_SIZE; col++) {
      const { boost, lane } = armProfile(radiusPc, armLutAzimuthRad(col));
      const at = (row * ARM_LUT_SIZE + col) * 2;
      out[at] = boost;
      out[at + 1] = lane;
    }
  }
  return out;
}
