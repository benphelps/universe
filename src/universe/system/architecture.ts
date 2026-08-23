import { logNormal } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import { isolationMassEarth, type DiskModel } from './disk';
import type { PlanetClass } from './types';

const EARTH_PER_SOLAR = 3.003e-6;
const MAX_PLANETS = 15;
/** 13 M_J: the deuterium-burning boundary. */
const MAX_PLANET_MASS_EARTH = 4130;

export interface PlanetSlot {
  aAu: number;
  massEarth: number;
  class: PlanetClass;
  isGiant: boolean;
  /** Scattering history: samples broader eccentricities downstream. */
  scattered: boolean;
  resonanceWithInner: string | null;
}

/** Mutual Hill factor: R_H,mutual / mean semi-major axis. */
export function mutualHillFactor(m1Earth: number, m2Earth: number, starMassSolar: number): number {
  return (((m1Earth + m2Earth) * EARTH_PER_SOLAR) / (3 * starMassSolar)) ** (1 / 3);
}

/**
 * Planet slot layout: march outward from the disk inner edge, assigning
 * each slot its feeding-zone mass (isolation mass × merger consolidation),
 * migrated-pileup mass for compact inner systems, and runaway gas
 * accretion where cores beyond the frost line pass the critical mass.
 * Spacing is drawn in mutual Hill radii, so packed super-Earth systems
 * and sparse giant systems emerge from one rule.
 */
export function layoutPlanets(
  rng: Rng,
  starMassSolar: number,
  feH: number,
  disk: DiskModel,
  innerLimitAu: number,
  outerLimitAu: number,
): PlanetSlot[] {
  const consolidation = logNormal(rng, Math.log(6), 0.4);
  const coreThresholdEarth = rng.range(10, 25);
  const migrationEfficiency = rng.float() ** 2;
  const migratedPileup = migrationEfficiency > 0.35;
  // Beyond this radius accretion is slower than the disk lifetime and
  // solids stay as debris; heavier disks form planets farther out.
  const growthLimitAu = Math.min(30, Math.max(5, rng.range(8, 18) * Math.sqrt(disk.sigma0 / 130)));

  const slots: PlanetSlot[] = [];
  let aAu = Math.max(
    innerLimitAu,
    Math.min(0.25, Math.max(0.02, logNormal(rng, Math.log(0.07), 0.5))),
  );
  const outermost = Math.min(outerLimitAu, disk.outerAu);

  while (aAu < outermost && slots.length < MAX_PLANETS) {
    // Inside the frost line, embryos merge up (consolidation); beyond it,
    // pebble-fed cores grow directly from the ice-rich feeding zone.
    const growthFactor = aAu < disk.frostLineAu ? consolidation : 2;
    const timescaleTaper = Math.exp(-((aAu / growthLimitAu) ** 1.5));
    if (timescaleTaper < 0.25) break;
    let massEarth =
      isolationMassEarth(disk, aAu, starMassSolar) *
      growthFactor *
      timescaleTaper *
      logNormal(rng, 0, 0.35);
    if (migratedPileup && aAu < 0.7) {
      massEarth = Math.max(massEarth, logNormal(rng, Math.log(5), 0.5) * (0.4 + migrationEfficiency));
    }

    let isGiant = false;
    if (massEarth >= coreThresholdEarth && aAu > disk.frostLineAu * 0.8) {
      const gasMultiplier = 10 ** rng.range(0.7, 2.2);
      massEarth = Math.min(MAX_PLANET_MASS_EARTH, massEarth * gasMultiplier);
      isGiant = true;
    }

    if (massEarth >= 0.05) {
      slots.push({
        aAu,
        massEarth,
        isGiant,
        class: classify(massEarth, aAu, disk.frostLineAu, rng),
        scattered: false,
        resonanceWithInner: null,
      });
    }

    const spacing = isGiant ? rng.range(8, 16) : rng.range(15, 40);
    const hill = mutualHillFactor(massEarth, massEarth, starMassSolar);
    aAu *= Math.max(1.12, 1 + spacing * hill);
  }

  applyHotJupiter(rng, slots, feH, starMassSolar);
  applyGiantScattering(rng, slots);
  applyResonantChain(rng, slots);
  return slots;
}

function classify(massEarth: number, aAu: number, frostAu: number, rng: Rng): PlanetClass {
  if (massEarth >= 50) return 'gas-giant';
  if (massEarth >= 10) return 'ice-giant';
  if (massEarth >= 3) {
    // The radius valley: beyond the frost line (or by draw) volatile
    // envelopes survive; close-in they are stripped.
    return aAu > frostAu || rng.bool(0.55) ? 'mini-neptune' : 'super-earth';
  }
  return massEarth >= 1.8 ? 'super-earth' : 'rocky';
}

/** Rare inward giant migration: ~1% of systems, metallicity-boosted. */
function applyHotJupiter(rng: Rng, slots: PlanetSlot[], feH: number, starMassSolar: number): void {
  const giantIndex = slots.findIndex((s) => s.isGiant);
  if (giantIndex < 0) return;
  const probability = 0.012 * 10 ** feH * (starMassSolar > 0.5 ? 1 : 0.1);
  if (!rng.bool(probability)) return;

  const giant = slots[giantIndex];
  giant.aAu = 10 ** rng.range(-1.7, -1);
  slots.splice(0, giantIndex);
  slots[0] = giant;
}

/** Giant–giant scattering: eccentric giants, interior small planets ejected. */
function applyGiantScattering(rng: Rng, slots: PlanetSlot[]): void {
  const giants = slots.filter((s) => s.isGiant);
  if (giants.length < 2 || !rng.bool(0.15)) return;
  for (const giant of giants) giant.scattered = true;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (!slots[i].isGiant && slots[i].aAu > giants[0].aAu * 0.5 && rng.bool(0.6)) {
      slots.splice(i, 1);
    }
  }
}

const CHAIN_RATIOS: Array<[string, number]> = [
  ['3:2', 1.5],
  ['2:1', 2],
  ['4:3', 4 / 3],
];

/**
 * Migration-built resonant chains for compact giant-free systems:
 * period ratios settle just wide of the exact commensurability, the
 * pileup Kepler observed.
 */
function applyResonantChain(rng: Rng, slots: PlanetSlot[]): void {
  if (slots.length < 3 || slots.some((s) => s.isGiant) || !rng.bool(0.25)) return;
  for (let i = 1; i < slots.length; i++) {
    const [label, ratio] = CHAIN_RATIOS[rng.int(CHAIN_RATIOS.length)];
    const periodRatio = ratio * (1 + rng.range(0.005, 0.03));
    slots[i].aAu = slots[i - 1].aAu * periodRatio ** (2 / 3);
    slots[i].resonanceWithInner = label;
  }
}
