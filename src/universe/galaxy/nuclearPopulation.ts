import { populationMoments } from './populationMoments';
import type { PopulationComponent } from './populationAge';
import { nuclearProfileCdf, NUCLEAR_TRUNCATION } from './nuclearProfile';
export { NUCLEAR_TRUNCATION, NUCLEAR_HELD_FRACTION } from './nuclearProfile';

/** Retained procedural age mixture: 93% at 8–12 Gyr and 7% at
 * 5–105 Myr BY NUMBER, including remnants. This is not a measured
 * universal nuclear star-formation history or a fitted Galactic centre. */
export const NUCLEAR_EPOCHS: readonly { component: PopulationComponent; numberShare: number; scalePc: number | null }[] = [
  { component: 'thick-disk', numberShare: 0.93, scalePc: null },
  { component: 'nuclear-young', numberShare: 0.07, scalePc: 0.6 },
];

/** Own present-day population, rather than the halo or galaxy mean. */
export function nuclearMeanStellarMass(): number {
  return NUCLEAR_EPOCHS.reduce((mass, epoch) => mass + epoch.numberShare * populationMoments(epoch.component).massSolar, 0);
}

/** Same normalized, finite Hernquist CDF used for positions and the
 * population inventory. The young component is currently spherical;
 * calling it a rotating disc would misrepresent this static model. */
export function nuclearEnclosedFraction(radiusPc: number, scalePc: number): number {
  return nuclearProfileCdf(radiusPc / scalePc);
}

export function nuclearHalfMassRadius(oldScalePc: number): number {
  const total = nuclearMeanStellarMass();
  let lo = 0, hi = NUCLEAR_TRUNCATION * Math.max(oldScalePc, 0.6);
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const held = NUCLEAR_EPOCHS.reduce((sum, e) => sum + e.numberShare * populationMoments(e.component).massSolar *
      nuclearEnclosedFraction(mid, e.scalePc ?? oldScalePc), 0);
    if (held < total / 2) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
