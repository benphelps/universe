import type { Vec3 } from '../../core/math/vec3';
import type { IncidentBeam } from './illumination';

/** Positive time weights folded into each beam vector. Averaging clipped
 * cosines preserves the terminator; interpolating a coarse light map does not.
 * All members are plain data so workers receive the identical field. */
export interface AnnualBeamField {
  weightedDirections: Float64Array;
  sum: Vec3;
  axis: Vec3;
  /** Certified enclosing cone. One disables the hemisphere shortcuts. */
  horizonBand: number;
  meanFluxWm2: number;
}

export function annualBeamField(beams: readonly IncidentBeam[], timeWeight: number): AnnualBeamField {
  const weightedDirections = new Float64Array(beams.length * 3);
  const sum = { x: 0, y: 0, z: 0 };
  let total = 0;
  for (let k = 0; k < beams.length; k++) {
    const { direction: d, fluxWm2 } = beams[k], weight = fluxWm2 * timeWeight;
    weightedDirections.set([d.x * weight, d.y * weight, d.z * weight], k * 3);
    sum.x += d.x * weight; sum.y += d.y * weight; sum.z += d.z * weight;
    total += weight;
  }
  const length = Math.hypot(sum.x, sum.y, sum.z);
  const axis = length > 0 ? { x: sum.x / length, y: sum.y / length, z: sum.z / length } : { x: 1, y: 0, z: 0 };
  let minCos = 1;
  for (const b of beams) if (b.fluxWm2 > 0) {
    minCos = Math.min(minCos, axis.x * b.direction.x + axis.y * b.direction.y + axis.z * b.direction.z);
  }
  // Inflate slightly: floating-point roundoff must never classify a partly
  // illuminated ray as fully dark/lit at the enclosing cone's horizon.
  const horizonBand = minCos > 0 ? Math.min(1, Math.sqrt(Math.max(0, 1 - minCos * minCos)) + 1e-7) : 1;
  return { weightedDirections, sum, axis, horizonBand, meanFluxWm2: total / 4 };
}

/** Unit body-frame normal. Constant work away from the source cone's
 * horizon; the bounded time quadrature is evaluated only inside that band. */
export function annualBeamFluxAt(field: AnnualBeamField, normal: Vec3): number {
  const projection = normal.x * field.axis.x + normal.y * field.axis.y + normal.z * field.axis.z;
  if (field.horizonBand < 1) {
    if (projection <= -field.horizonBand) return 0;
    if (projection >= field.horizonBand) {
      return Math.max(0, normal.x * field.sum.x + normal.y * field.sum.y + normal.z * field.sum.z);
    }
  }
  const b = field.weightedDirections;
  let flux = 0;
  for (let i = 0; i < b.length; i += 3) flux += Math.max(0, normal.x * b[i] + normal.y * b[i + 1] + normal.z * b[i + 2]);
  return flux;
}
