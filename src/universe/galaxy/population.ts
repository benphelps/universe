import type { Rng } from '../../core/rng/rng';
import { componentDensities, type GalacticPosition } from './density';

export interface PopulationDraw {
  ageGyr: number;
  feH: number;
  component: 'thin-disk' | 'thick-disk' | 'halo';
}

/** Disk radial metallicity gradient, dex per pc, anchored at the sun. */
const GRADIENT_DEX_PER_PC = -0.06 / 1000;

/**
 * Age and metallicity for a star born where it sits: the galactic
 * component is drawn from the local density mix (thin disk young and
 * near-solar with a radial gradient, thick disk old and metal-poor,
 * halo ancient and very metal-poor). One shared draw sequence — the
 * full generator and the sky photometry both call this, so a sky point
 * and the star a player travels to always agree.
 */
export function drawPopulation(rng: Rng, position: GalacticPosition): PopulationDraw {
  const densities = componentDensities(position);
  const total = densities.thin + densities.thick + densities.halo;
  const pick = rng.float() * total;
  const radius = Math.hypot(position.xPc, position.yPc);
  const diskFeH = GRADIENT_DEX_PER_PC * (radius - 8000);

  if (pick < densities.thin) {
    // Near-constant star formation with a mild recent-history bias.
    const ageGyr = 0.03 + 9.97 * rng.float() ** 1.2;
    const feH = rng.normal(diskFeH - 0.01 * ageGyr, 0.15);
    return { ageGyr, feH: clampFeH(feH), component: 'thin-disk' };
  }
  if (pick < densities.thin + densities.thick) {
    const ageGyr = 8 + 4 * rng.float();
    const feH = rng.normal(-0.55 + 0.3 * diskFeH, 0.25);
    return { ageGyr, feH: clampFeH(feH), component: 'thick-disk' };
  }
  const ageGyr = 10 + 3.2 * rng.float();
  const feH = rng.normal(-1.5, 0.45);
  return { ageGyr, feH: clampFeH(feH), component: 'halo' };
}

function clampFeH(feH: number): number {
  return Math.min(0.6, Math.max(-2.5, feH));
}
