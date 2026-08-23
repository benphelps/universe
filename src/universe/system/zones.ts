import type { SystemZones } from './types';

interface HzCoefficients {
  sEffSun: number;
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Kopparapu et al. (2014) effective-flux fits, 1 M⊕ planet. */
const RUNAWAY_GREENHOUSE: HzCoefficients = {
  sEffSun: 1.107,
  a: 1.332e-4,
  b: 1.58e-8,
  c: -8.308e-12,
  d: -1.931e-15,
};
const MAXIMUM_GREENHOUSE: HzCoefficients = {
  sEffSun: 0.356,
  a: 6.171e-5,
  b: 1.698e-9,
  c: -3.198e-12,
  d: -5.575e-16,
};

function effectiveFlux(coeffs: HzCoefficients, tEff: number): number {
  // Fit domain 2600–7200 K; clamp beyond it.
  const t = Math.min(7200, Math.max(2600, tEff)) - 5780;
  return coeffs.sEffSun + coeffs.a * t + coeffs.b * t ** 2 + coeffs.c * t ** 3 + coeffs.d * t ** 4;
}

/** Habitable-zone bound in AU: d = √(L / S_eff). */
function zoneDistanceAu(coeffs: HzCoefficients, luminosity: number, tEff: number): number {
  return Math.sqrt(luminosity / effectiveFlux(coeffs, tEff));
}

/** Water frost line at the current epoch (T ≈ 170 K). */
export function frostLineAu(luminosity: number): number {
  return 2.7 * Math.sqrt(luminosity);
}

/**
 * Orbit radius inside which a planet is tidally locked by the system's
 * age: t_lock ∝ a⁶/M★², solar-calibrated so Mercury stays unlocked and
 * M-dwarf habitable zones lock within a few Gyr.
 */
export function tidalLockAu(ageGyr: number, starMassSolar: number): number {
  return 0.13 * (ageGyr * starMassSolar ** 2) ** (1 / 6);
}

export function computeZones(
  luminosity: number,
  tEff: number,
  ageGyr: number,
  centralMassSolar: number,
): SystemZones {
  return {
    habitableInnerAu: zoneDistanceAu(RUNAWAY_GREENHOUSE, luminosity, tEff),
    habitableOuterAu: zoneDistanceAu(MAXIMUM_GREENHOUSE, luminosity, tEff),
    frostLineAu: frostLineAu(luminosity),
    tidalLockAu: tidalLockAu(ageGyr, centralMassSolar),
  };
}
