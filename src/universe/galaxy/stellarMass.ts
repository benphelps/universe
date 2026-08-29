import { evolve } from '../star/evolution';
import { initialMassFromUnit, massUnitForMass, KROUPA_SEGMENTS } from '../star/imf';
import { armProfile, HOME_POSITION, smoothComponentDensities } from './density';
import { populationFromUnit } from './population';

/**
 * How much stellar mass the galaxy's own density model holds. The
 * density field is in stars per pc³, so the mass follows from one
 * number the population fixes — the mean present-day mass of a star —
 * and one integral over the field. Nothing here is assumed: change the
 * disk's scale length and the galaxy's mass changes with it.
 */

const IMF_MIN = KROUPA_SEGMENTS[0].min;
const IMF_MAX = KROUPA_SEGMENTS[KROUPA_SEGMENTS.length - 1].max;

let meanMassMemo = 0;

/**
 * Mean present-day mass per star, M☉: the IMF crossed with the field
 * population's age distribution, each mass evolved to its current
 * state so mass-loss and remnants are counted as they actually are.
 * Stratified on both axes for the same reason the luminosity twin is —
 * the answer must not depend on who is asking.
 */
export function meanStellarMass(): number {
  if (meanMassMemo > 0) return meanMassMemo;
  const strata = 64;
  const ages: number[] = [];
  for (let i = 0; i < strata; i++) {
    ages.push(populationFromUnit((i + 0.5) / strata, HOME_POSITION).ageGyr);
  }

  const bins = 64;
  let weightSum = 0;
  let massSum = 0;
  for (let b = 0; b < bins; b++) {
    const m0 = IMF_MIN * (IMF_MAX / IMF_MIN) ** (b / bins);
    const m1 = IMF_MIN * (IMF_MAX / IMF_MIN) ** ((b + 1) / bins);
    const weight = massUnitForMass(m1) - massUnitForMass(m0);
    const mass = initialMassFromUnit(
      (massUnitForMass(m0) + massUnitForMass(m1)) / 2,
    );
    let current = 0;
    for (const age of ages) current += evolve(mass, age).mass;
    massSum += (weight * current) / ages.length;
    weightSum += weight;
  }
  meanMassMemo = massSum / Math.max(weightSum, 1e-12);
  return meanMassMemo;
}

let diskCountMemo = 0;

/**
 * Total stars in the disk and halo, from the density model itself.
 * The smooth components have no azimuth dependence, so they integrate
 * on an (R, z) grid; the spiral wave enters as its own density-weighted
 * mean enhancement of the thin disk, sampled around each ring. Both
 * grids run to where the exponentials have nothing left to give.
 */
export function galaxyStarCount(): number {
  if (diskCountMemo > 0) return diskCountMemo;
  const radialSteps = 240;
  const heightSteps = 120;
  const azimuthSteps = 48;
  const maxRadius = 40000;
  const maxHeight = 12000;
  const dR = maxRadius / radialSteps;
  const dz = maxHeight / heightSteps;

  let total = 0;
  for (let i = 0; i < radialSteps; i++) {
    const radius = (i + 0.5) * dR;
    // Mean arm enhancement around this ring: the wave multiplies the
    // thin disk only, and its azimuthal average is what the mass sees.
    let boostSum = 0;
    for (let a = 0; a < azimuthSteps; a++) {
      boostSum += armProfile(radius, ((a + 0.5) * 2 * Math.PI) / azimuthSteps).boost;
    }
    const armMean = 1 + boostSum / azimuthSteps;

    // z symmetric about the midplane: integrate one side and double.
    let column = 0;
    for (let k = 0; k < heightSteps; k++) {
      const height = (k + 0.5) * dz;
      const { thin, thick, halo } = smoothComponentDensities({
        xPc: radius,
        yPc: 0,
        zPc: height,
      });
      column += (thin * armMean + thick + halo) * dz;
    }
    total += 2 * column * 2 * Math.PI * radius * dR;
  }
  diskCountMemo = total;
  return diskCountMemo;
}

/** Stellar mass of the whole galaxy, M☉ — count times mean mass. */
export function galaxyStellarMass(): number {
  return galaxyStarCount() * meanStellarMass();
}
