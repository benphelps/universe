import type { Rng } from '../../core/rng/rng';
import type { StarActivity, StellarPhysical } from './types';

/**
 * Rotation, spin axis, spots, flares, granulation, and limb darkening.
 * Convective-envelope stars (M ≲ 1.3 M☉) spin down with age
 * (gyrochronology) and derive activity from rotation speed; radiative
 * stars keep fast primordial spin but little magnetic activity. Below
 * ~2400 K the photosphere goes neutral and lets go of the field, so
 * spots and flares quench through the late-M/L range; what survives on
 * the coolest objects is weather — patchy silicate clouds, thickest at
 * the L/T transition.
 */
export function computeActivity(rng: Rng, phys: StellarPhysical, ageGyr: number): StarActivity {
  const convective = phys.mass < 1.3;
  const rotationPeriodDays = rotationPeriod(rng, phys, ageGyr, convective);

  // Rossby-style proxy: fast convective rotators are active — as far
  // as the atmosphere stays ionized enough to grip the field.
  const ionization = smoothstep(1400, 2400, phys.tEff);
  const activityIndex =
    ionization *
    (convective ? Math.min(1, 3 / rotationPeriodDays) : Math.min(0.1, 0.3 / rotationPeriodDays));

  const surfaceGravityRel = phys.mass / phys.radius ** 2;

  // Spin axes lean on the system's plane: convective envelopes are
  // tidally realigned over time (the cool side of the Kraft break),
  // radiative stars keep whatever chaotic accretion left them, and a
  // few percent are wildly misaligned — up to spinning backwards.
  const axialTiltRad = rng.bool(0.03)
    ? rng.range(1.0, Math.PI)
    : Math.abs(rng.normal(0, convective ? 0.15 : 0.4));

  // Condensate clouds: form through the L types, break into rotating
  // patches near the L/T transition (~1300 K), rain out in the T's.
  const cloudPatchiness = Math.exp(-(((phys.tEff - 1300) / 500) ** 2)) * rng.range(0.15, 0.45);

  return {
    rotationPeriodDays,
    axialTiltRad,
    axialAzimuthRad: rng.range(0, 2 * Math.PI),
    differentialRotation: convective ? rng.range(0.1, 0.3) : rng.range(0.02, 0.08),
    spotCoverage: Math.min(0.4, 0.002 * ionization + 0.3 * activityIndex * activityIndex),
    spotLatitudeRad: rng.range(0.2, 0.6),
    cloudPatchiness,
    flareRatePerDay: ionization * (phys.mass < 0.5 ? 0.3 + 2 * activityIndex : 0.05 * activityIndex),
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
