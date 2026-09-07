import { componentAgeForUnit, componentUnitForAge, thinAgeForUnit, type StellarComponent } from './populationAge';
export { thinAgeForUnit } from './populationAge';
import type { Rng } from '../../core/rng/rng';
import { componentDensities, type GalacticPosition } from './density';

export interface PopulationDraw {
  ageGyr: number;
  component: StellarComponent;
}

/** Disk radial metallicity gradient, dex per pc, anchored at the sun. */
const GRADIENT_DEX_PER_PC = -0.06 / 1000;

/**
 * Component and age for a star born where it sits, as an explicit
 * inverse CDF over one unit value: the local density mix partitions
 * [0, 1) into thin disk, thick disk, and halo bands (in that fixed
 * order), and the remainder maps monotonically through the component's
 * age distribution — thin disk young and near-constant star formation,
 * thick disk old, halo ancient. Because the map is explicit, the star
 * catalog can address stars by age (a seed's age bits pass through this
 * same function), and the young thin-disk band is a contiguous prefix.
 */
export function populationFromUnit(u: number, position: GalacticPosition): PopulationDraw {
  const densities = componentDensities(position);
  const total = densities.thin + densities.thick + densities.halo + densities.bulge;
  const thinBand = densities.thin / total;
  const thickBand = densities.thick / total;

  if (u < thinBand) {
    return { ageGyr: thinAgeForUnit(u / thinBand), component: 'thin-disk' };
  }
  if (u < thinBand + thickBand) {
    return { ageGyr: componentAgeForUnit('thick-disk', (u - thinBand) / thickBand), component: 'thick-disk' };
  }
  const haloBand = densities.halo / total;
  if (u < thinBand + thickBand + haloBand) {
    return { ageGyr: componentAgeForUnit('halo', (u - thinBand - thickBand) / haloBand), component: 'halo' };
  }
  const v = (u - thinBand - thickBand - haloBand) / Math.max(densities.bulge / total, 1e-12);
  return { ageGyr: componentAgeForUnit('bulge', v), component: 'bulge' };
}

/** Inverse of thinAgeForUnit: the thin-disk unit below an age. */
export function thinUnitForAge(ageGyr: number): number {
  return componentUnitForAge('thin-disk', ageGyr);
}

/**
 * Metallicity of the interstellar medium where it sits: the disk
 * gradient alone. A cloud is what stars are drawn from, not a draw
 * itself, so it takes the mean rather than a scattered sample.
 */
export function ismMetallicity(position: GalacticPosition): number {
  const radius = Math.hypot(position.xPc, position.yPc);
  return Math.min(0.6, Math.max(-2.5, GRADIENT_DEX_PER_PC * (radius - 8000)));
}

/** Metallicity for a drawn population member (the stream-random part). */
export function metallicityFor(
  rng: Rng,
  draw: PopulationDraw,
  position: GalacticPosition,
): number {
  const diskFeH = ismMetallicity(position);
  const feH =
    draw.component === 'thin-disk'
      ? rng.normal(diskFeH - 0.01 * draw.ageGyr, 0.15)
      : draw.component === 'thick-disk'
        ? rng.normal(-0.55 + 0.3 * diskFeH, 0.25)
        : draw.component === 'bulge'
          ? rng.normal(-0.1, 0.35)
          : rng.normal(-1.5, 0.45);
  return Math.min(0.6, Math.max(-2.5, feH));
}
