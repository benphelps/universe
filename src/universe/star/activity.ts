import type { Rng } from '../../core/rng/rng';
import type { StarActivity, StellarPhysical } from './types';

/**
 * Rotation, spots, flares, granulation, and limb darkening.
 * Convective-envelope stars (M ≲ 1.3 M☉) spin down with age
 * (gyrochronology) and derive activity from rotation speed; radiative
 * stars keep fast primordial spin but little magnetic activity.
 */
export function computeActivity(rng: Rng, phys: StellarPhysical, ageGyr: number): StarActivity {
  const convective = phys.mass < 1.3;
  const rotationPeriodDays = rotationPeriod(rng, phys, ageGyr, convective);

  // Rossby-style proxy: fast convective rotators are active.
  const activityIndex = convective
    ? Math.min(1, 3 / rotationPeriodDays)
    : Math.min(0.1, 0.3 / rotationPeriodDays);

  const surfaceGravityRel = phys.mass / phys.radius ** 2;

  return {
    rotationPeriodDays,
    axialTiltRad: rng.range(0, 0.5),
    differentialRotation: convective ? rng.range(0.1, 0.3) : rng.range(0.02, 0.08),
    spotCoverage: Math.min(0.4, 0.002 + 0.3 * activityIndex * activityIndex),
    spotLatitudeRad: rng.range(0.2, 0.6),
    flareRatePerDay: phys.mass < 0.5 ? 0.3 + 2 * activityIndex : 0.05 * activityIndex,
    // Granule size ∝ pressure scale height ∝ T/g.
    granuleRelativeScale: Math.max(0.2, (phys.tEff / 5772) / Math.max(surfaceGravityRel, 1e-8)),
    limbDarkeningU: clamp(0.4 + (0.5 * (7000 - phys.tEff)) / 4000, 0.2, 0.95),
  };
}

function rotationPeriod(
  rng: Rng,
  phys: StellarPhysical,
  ageGyr: number,
  convective: boolean,
): number {
  switch (phys.stage) {
    case 'neutron-star':
      // Milliseconds to seconds, expressed in days.
      return rng.range(0.002, 3) / 86400;
    case 'white-dwarf':
      return rng.range(0.05, 2);
    case 'giant':
    case 'horizontal-branch':
    case 'agb':
    case 'supergiant':
      return rng.range(100, 500);
    case 'brown-dwarf':
      return rng.range(0.1, 0.5);
    default:
      if (!convective) return rng.range(0.5, 3);
      // Skumanich-style spin-down: P ∝ √age, solar-calibrated.
      return 25 * phys.mass ** 0.9 * Math.sqrt(Math.max(ageGyr, 0.1) / 4.6) * rng.range(0.7, 1.3);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
