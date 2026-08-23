import { orbitalPeriod } from '../../core/math/orbit';
import type { Rng } from '../../core/rng/rng';
import { logNormal } from '../../core/rng/distributions';
import type { PlanetClass } from '../system/types';
import type { PlanetRotation } from './types';

const DEG = Math.PI / 180;

/**
 * Primordial spin, then tidal despinning: inside the lock radius planets
 * are synchronous (or captured into 3:2 when eccentric, Mercury-style).
 * Obliquities are broad, with occasional tipped Uranus-class outliers.
 */
export function computeRotation(
  rng: Rng,
  planetClass: PlanetClass,
  aAu: number,
  eccentricity: number,
  tidalLockAu: number,
  mu: number,
  semiMajorAxisM: number,
): PlanetRotation {
  const orbitalHours = orbitalPeriod(mu, semiMajorAxisM) / 3600;
  const giant = planetClass === 'gas-giant' || planetClass === 'ice-giant';

  if (aAu < tidalLockAu) {
    if (eccentricity > 0.15 && !giant && rng.bool(0.5)) {
      return {
        periodHours: orbitalHours / 1.5,
        obliquityRad: rng.range(0, 2) * DEG,
        locked: false,
        spinOrbitResonance: '3:2',
      };
    }
    return { periodHours: orbitalHours, obliquityRad: 0, locked: true, spinOrbitResonance: null };
  }

  const periodHours = giant
    ? rng.range(8, 16)
    : Math.min(logNormal(rng, Math.log(18), 0.5), orbitalHours / 3);
  const tipped = rng.bool(0.08);
  return {
    periodHours,
    obliquityRad: tipped ? rng.range(60, 178) * DEG : Math.abs(rng.normal(0, 18)) * DEG,
    locked: false,
    spinOrbitResonance: null,
  };
}
