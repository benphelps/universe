import { AU } from '../../core/physics/constants';
import { powerLaw, rayleigh } from '../../core/rng/distributions';
import { deriveSeed, seedToHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Belt } from '../system/types';
import type { Asteroid, AsteroidTaxonomy } from './types';

/** Cumulative size-frequency slope N(>D) ∝ D^-q, collisional equilibrium. */
export const SFD_SLOPE = 2.3;

/** Rubble piles fly apart below this spin period. */
const SPIN_BARRIER_HOURS = 2.2;

/**
 * Deterministic asteroid instantiation for one cell of a belt. Cells are
 * seeded independently, so any region can materialize at any time — and
 * always identically. Diameters follow the belt SFD down to minDiameterKm.
 */
export function instantiateBeltCell(
  beltSeed: bigint,
  belt: Belt,
  cellIndex: number,
  count: number,
  minDiameterKm = 0.5,
): Asteroid[] {
  const rng = new Rng(deriveSeed(beltSeed, 'cell', cellIndex));
  const asteroids: Asteroid[] = [];
  while (asteroids.length < count) {
    // Area-uniform semi-major axis, thinned inside resonance gaps.
    const aAu = Math.sqrt(
      belt.innerAu ** 2 + rng.float() * (belt.outerAu ** 2 - belt.innerAu ** 2),
    );
    const inGap = belt.gaps.some((gap) => Math.abs(aAu - gap.semiMajorAxisAu) < gap.widthAu / 2);
    if (inGap && rng.float() < 0.92) continue;

    const diameterKm = powerLaw(rng, SFD_SLOPE + 1, minDiameterKm, 400);
    asteroids.push(buildAsteroid(rng, belt, aAu, diameterKm));
  }
  return asteroids;
}

export function buildAsteroid(rng: Rng, belt: Belt, aAu: number, diameterKm: number): Asteroid {
  // Taxonomy by zone: silicaceous inner belt, carbonaceous outer, rare metallic.
  const zoneFraction = (aAu - belt.innerAu) / (belt.outerAu - belt.innerAu);
  let taxonomy: AsteroidTaxonomy;
  if (rng.bool(0.04)) taxonomy = 'M';
  else if (belt.kind === 'outer') taxonomy = rng.bool(0.6) ? 'D' : 'C';
  else taxonomy = rng.float() > zoneFraction * 0.8 ? 'S' : 'C';
  const albedo = { S: 0.22, C: 0.06, M: 0.15, D: 0.05 }[taxonomy];

  // Bodies above ~50 km survive as coherent-ish; smaller ones are shattered rubble.
  const rubblePile = diameterKm > 0.2 && diameterKm < 50 ? rng.bool(0.85) : rng.bool(0.3);
  let spinPeriodHours = 10 ** rng.normal(Math.log10(8), 0.5);
  if (rubblePile && spinPeriodHours < SPIN_BARRIER_HOURS) {
    spinPeriodHours = SPIN_BARRIER_HOURS * rng.range(1.0, 1.6);
  }
  const tumbling = spinPeriodHours > 40 && rng.bool(0.5);

  // Small bodies are lumpy; hydrostatic rounding wins above ~300 km.
  const roundness = Math.min(1, diameterKm / 300);
  return {
    elements: {
      semiMajorAxis: aAu * AU,
      eccentricity: Math.min(0.4, rayleigh(rng, 0.07)),
      inclination: rayleigh(rng, belt.inclinationDispersionRad * 0.6),
      longitudeOfAscendingNode: rng.range(0, 2 * Math.PI),
      argumentOfPeriapsis: rng.range(0, 2 * Math.PI),
      meanAnomalyAtEpoch: rng.range(0, 2 * Math.PI),
      epoch: 0,
    },
    diameterKm,
    taxonomy,
    albedo,
    spinPeriodHours,
    tumbling,
    rubblePile,
    shape: {
      elongation: 1 - (1 - roundness) * rng.range(0.15, 0.55),
      flattening: 1 - (1 - roundness) * rng.range(0.1, 0.4),
      contactBinary: diameterKm < 30 && rng.bool(0.15),
      noiseSeedHex: seedToHex(deriveSeed(rng.seed, 'shape')),
    },
  };
}
