import type { Star } from '../../universe/star/types';

const TAU = 2 * Math.PI;
const EPOCH_MODULUS = 4096;

export interface StellarSurfaceModel {
  granuleFrequency: number;
  granuleLifetimeDays: number;
  granulationStrength: number;
  granulationDeltaK: number;
  spotLifetimeDays: number;
  spotTemperatureDeficitK: number;
  faculaTemperatureExcessK: number;
}

export interface StellarSurfaceState {
  /** Equatorial material phase, radians. */
  rotationPhase: number;
  /** Magnetic active-region phase at the center of the spot belts. */
  spotRotationPhase: number;
  /** Newly emerging active-region generation. */
  spotCurrentEpoch: number;
  /** Generation fading out while the current one emerges. */
  spotPreviousEpoch: number;
  /** Progress between generation handoffs, [0, 1). */
  spotPhase: number;
  granuleEpoch: number;
  granulePhase: number;
}

/**
 * Rendering closure for a stellar photosphere. Granule size and lifetime
 * both follow the pressure-scale-height proxy already carried by activity;
 * compact remnants opt out of the main-sequence magnetic-spot model.
 */
export function stellarSurfaceModel(star: Star): StellarSurfaceModel {
  const scale = Math.max(star.activity.granuleRelativeScale, 0.05);
  const granuleFrequency = Math.min(180, Math.max(3, 110 / Math.sqrt(scale)));
  // Solar granules live roughly 10–20 minutes. Low-gravity giants stretch
  // the same convective clock to hours or days; the upper bound prevents an
  // extreme supergiant cell from becoming a permanent painted continent.
  const granuleLifetimeDays = clamp((20 / 1440) * scale, 1 / 1440, 30);

  let granulationStrength: number;
  switch (star.stage) {
    case 'black-hole':
    case 'neutron-star':
      granulationStrength = 0;
      break;
    case 'white-dwarf':
      // DA photospheres develop fine convection through the partial-
      // ionization range, but not the giant solar-like active regions that
      // the former mass-only activity test accidentally assigned them.
      granulationStrength = 0.42 * inverseSmoothstep(10_000, 20_000, star.tEff);
      break;
    case 'brown-dwarf':
      granulationStrength = 0.35;
      break;
    default:
      // Hot radiative envelopes are visually much smoother than FGKM
      // convective photospheres.
      granulationStrength = inverseSmoothstep(6500, 9500, star.tEff);
      break;
  }

  const coverage01 = Math.sqrt(clamp(star.activity.spotCoverage / 0.4, 0, 1));
  const spotLifetimeDays = clamp(
    star.activity.rotationPeriodDays * (1.5 + 8 * coverage01),
    5,
    1000,
  );

  return {
    granuleFrequency,
    granuleLifetimeDays,
    granulationStrength,
    granulationDeltaK: star.tEff * (0.018 + 0.018 * granulationStrength),
    spotLifetimeDays,
    spotTemperatureDeficitK: Math.min(1600, Math.max(180, star.tEff * 0.28)),
    faculaTemperatureExcessK: Math.min(360, Math.max(40, star.tEff * 0.045)),
  };
}

/**
 * All phases are reduced on the CPU in float64 before upload. A spot field
 * rotates coherently at its belt latitude and is replaced after a finite
 * lifetime; no fragment accumulates latitude-dependent shear forever.
 */
export function stellarSurfaceStateAt(
  star: Star,
  model: StellarSurfaceModel,
  timeDays: number,
): StellarSurfaceState {
  const rotationCycles = timeDays / Math.max(star.activity.rotationPeriodDays, 1e-8);
  const rotationPhase = positiveMod(rotationCycles, 1) * TAU;
  const spotRate = Math.max(
    0.02,
    1 -
      star.activity.differentialRotation *
        Math.sin(star.activity.spotLatitudeRad) ** 2,
  );
  const spotRotationPhase = positiveMod(rotationCycles * spotRate, 1) * TAU;

  // Active generations overlap by half a lifetime. At a slot boundary the
  // old "current" generation becomes the new "previous" generation, so the
  // shader can crossfade without a pop or a permanently stretched texture.
  const spotSlot = Math.max(model.spotLifetimeDays * 0.5, 1e-6);
  const spotCycle = cycleAt(timeDays, spotSlot);
  const spotCurrentEpoch = positiveMod(spotCycle.epoch, EPOCH_MODULUS);
  const spotPreviousEpoch = positiveMod(spotCurrentEpoch - 1, EPOCH_MODULUS);

  const granuleCycle = cycleAt(timeDays, Math.max(model.granuleLifetimeDays, 1e-8));
  return {
    rotationPhase,
    spotRotationPhase,
    spotCurrentEpoch,
    spotPreviousEpoch,
    spotPhase: spotCycle.phase,
    granuleEpoch: positiveMod(granuleCycle.epoch, EPOCH_MODULUS),
    granulePhase: granuleCycle.phase,
  };
}

function cycleAt(time: number, period: number): { epoch: number; phase: number } {
  const epoch = Math.floor(time / period);
  return { epoch, phase: (time - epoch * period) / period };
}

function positiveMod(value: number, modulus: number): number {
  const result = value % modulus;
  return result < 0 ? result + modulus : result;
}

function inverseSmoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return 1 - x * x * (3 - 2 * x);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
