import { AU } from '../../core/physics/constants';
import { deriveSeed, mix64 } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Belt } from '../system/types';
import { buildAsteroid, SFD_SLOPE } from './asteroids';
import type { Asteroid } from './types';

/**
 * The belt as a materializable population: orbital cells keyed by
 * semi-major-axis band and epoch mean-longitude sector, so the members
 * near any point in the belt at any time can be instantiated — always
 * identically — by predicting which sectors Keplerian motion has carried
 * there. Counts follow a main-belt-like size–frequency distribution
 * scaled by the belt's annulus area; bodies above the notable threshold
 * are excluded (they ride the stepper as named landmarks).
 */
export const BELT_SECTORS = 256;
/** Bodies at or above this size belong to the notables list instead. */
export const CELL_MAX_DIAMETER_KM = 150;

/** Narrow bands keep Keplerian shear predictable over long sim times. */
export function beltBandCount(belt: Belt): number {
  return Math.min(160, Math.max(8, Math.round((belt.outerAu - belt.innerAu) / 0.04)));
}

/** Cumulative count above D km, main-belt-normalized by annulus area. */
export function beltCountAbove(belt: Belt, diameterKm: number): number {
  const areaAu2 = Math.PI * (belt.outerAu ** 2 - belt.innerAu ** 2);
  return 1.3e6 * (areaAu2 / 20) * diameterKm ** -SFD_SLOPE;
}

/** Bounded-Pareto diameter draw on [minKm, CELL_MAX_DIAMETER_KM]. */
function drawDiameter(rng: Rng, minKm: number): number {
  const s = SFD_SLOPE;
  const ratio = (CELL_MAX_DIAMETER_KM / minKm) ** -s;
  const u = rng.float();
  return minKm * (1 - u * (1 - ratio)) ** (-1 / s);
}

/**
 * The asteroids of one orbital cell. Epoch mean longitudes land inside
 * the sector, so a cell's members stay findable from the sector index
 * however far the epoch drifts.
 */
export function beltCellAsteroids(
  beltSeed: bigint,
  belt: Belt,
  band: number,
  sector: number,
  minDiameterKm: number,
): Asteroid[] {
  const bands = beltBandCount(belt);
  const wrapped = ((sector % BELT_SECTORS) + BELT_SECTORS) % BELT_SECTORS;
  const seed = mix64(
    deriveSeed(beltSeed, 'region') ^
      ((BigInt(band & 0xffff) << 24n) | BigInt(wrapped & 0xffffff)),
  );
  const rng = new Rng(seed);

  const inner2 = belt.innerAu ** 2;
  const outer2 = belt.outerAu ** 2;
  const a0Sq = inner2 + ((outer2 - inner2) * band) / bands;
  const a1Sq = inner2 + ((outer2 - inner2) * (band + 1)) / bands;
  const expected =
    ((beltCountAbove(belt, minDiameterKm) - beltCountAbove(belt, CELL_MAX_DIAMETER_KM)) *
      ((a1Sq - a0Sq) / (outer2 - inner2))) /
    BELT_SECTORS;
  const count = Math.floor(expected + rng.float());

  const asteroids: Asteroid[] = [];
  for (let i = 0; i < count; i++) {
    const aAu = Math.sqrt(a0Sq + rng.float() * (a1Sq - a0Sq));
    // Kirkwood gaps thin the population here like everywhere else.
    const inGap = belt.gaps.some((gap) => Math.abs(aAu - gap.semiMajorAxisAu) < gap.widthAu / 2);
    if (inGap && rng.float() < 0.92) continue;

    const asteroid = buildAsteroid(rng, belt, aAu, drawDiameter(rng, minDiameterKm));
    const longitude = ((wrapped + rng.float()) * 2 * Math.PI) / BELT_SECTORS;
    const { elements } = asteroid;
    elements.meanAnomalyAtEpoch =
      (((longitude - elements.longitudeOfAscendingNode - elements.argumentOfPeriapsis) %
        (2 * Math.PI)) +
        2 * Math.PI) %
      (2 * Math.PI);
    asteroids.push(asteroid);
  }
  return asteroids;
}

/** Mean motion at a band's center, rad/s, for sector prediction. */
export function bandMeanMotion(belt: Belt, band: number, mu: number): number {
  const bands = beltBandCount(belt);
  const inner2 = belt.innerAu ** 2;
  const outer2 = belt.outerAu ** 2;
  const aAu = Math.sqrt(inner2 + ((outer2 - inner2) * (band + 0.5)) / bands);
  return Math.sqrt(mu / (aAu * AU) ** 3);
}
