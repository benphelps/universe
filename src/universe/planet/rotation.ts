import { orbitalPeriod } from '../../core/math/orbit';
import type { Mu } from '../../core/physics/units';
import type { Rng } from '../../core/rng/rng';
import { logNormal } from '../../core/rng/distributions';
import type { PlanetClass } from '../system/types';
import type { PlanetRotation } from './types';

const DEG = Math.PI / 180;

/**
 * Primordial spin, then tidal despinning. Giants inhale their spin from
 * disk gas: fast, prograde, nearly upright, with rare resonance-walked
 * poles (Saturn's 27°, Uranus on its side). Terrestrials remember their
 * last giant impacts instead: isotropic obliquity, retrograde as often
 * as not. Inside the lock radius the tide takes over — synchronous,
 * Mercury's 3:2 when eccentric, or a Venus, where thermal tides in a
 * thick atmosphere stall the despin short of lock and hold a slow,
 * nearly upside-down spin whose day runs backwards against its year.
 */
export function computeRotation(
  rng: Rng,
  planetClass: PlanetClass,
  aAu: number,
  eccentricity: number,
  tidalLockAu: number,
  mu: Mu,
  semiMajorAxisM: number,
): PlanetRotation {
  const orbitalHours = orbitalPeriod(mu, semiMajorAxisM) / 3600;
  // Mini-Neptunes spin like their bigger siblings: the envelope's gas
  // carried the disk's angular momentum in, and there is no surface
  // for an impact- or thermal-tide-driven history to grip.
  const giant =
    planetClass === 'gas-giant' || planetClass === 'ice-giant' || planetClass === 'mini-neptune';

  if (aAu < tidalLockAu) {
    if (eccentricity > 0.15 && !giant && rng.bool(0.5)) {
      return {
        periodHours: orbitalHours / 1.5,
        obliquityRad: rng.range(0, 2) * DEG,
        locked: false,
        spinOrbitResonance: '3:2',
      };
    }
    // Only viable in the outer despin zone: closer in, the gravitational
    // tide overwhelms any atmosphere's thermal tide and the lock is clean.
    if (!giant && aAu > tidalLockAu * 0.75 && rng.bool(0.45)) {
      return {
        periodHours: orbitalHours * rng.range(0.7, 1.5),
        obliquityRad: rng.range(174, 179.5) * DEG,
        locked: false,
        spinOrbitResonance: null,
      };
    }
    return { periodHours: orbitalHours, obliquityRad: 0, locked: true, spinOrbitResonance: null };
  }

  if (giant) {
    const tipped = rng.bool(0.07);
    return {
      periodHours: rng.range(8, 16),
      obliquityRad: tipped ? rng.range(25, 105) * DEG : Math.abs(rng.normal(0, 5)) * DEG,
      locked: false,
      spinOrbitResonance: null,
    };
  }

  return {
    periodHours: Math.min(logNormal(rng, Math.log(18), 0.5), orbitalHours / 3),
    obliquityRad: Math.acos(rng.range(-1, 1)),
    locked: false,
    spinOrbitResonance: null,
  };
}
