import type { OrbitalElements } from '../../core/math/orbit';
import { AU } from '../../core/physics/constants';
import { rayleigh } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import type { PlanetSlot } from './architecture';

const DEG = Math.PI / 180;

/**
 * Full Keplerian elements for each slot, referenced to the system
 * invariable plane. Packed multi-planet systems are dynamically cold;
 * sparse systems are warmer; scattered giants are hot.
 */
export function assignElements(rng: Rng, slots: PlanetSlot[]): OrbitalElements[] {
  const packed = slots.length >= 4;
  return slots.map((slot) => {
    const sigmaE = slot.scattered ? 0.2 : packed ? 0.035 : 0.07;
    const sigmaI = (slot.scattered ? 4 : 1.5) * DEG;
    return {
      semiMajorAxis: slot.aAu * AU,
      eccentricity: Math.min(0.85, rayleigh(rng, sigmaE)),
      inclination: rayleigh(rng, sigmaI),
      longitudeOfAscendingNode: rng.range(0, 2 * Math.PI),
      argumentOfPeriapsis: rng.range(0, 2 * Math.PI),
      meanAnomalyAtEpoch: rng.range(0, 2 * Math.PI),
      epoch: 0,
    };
  });
}
