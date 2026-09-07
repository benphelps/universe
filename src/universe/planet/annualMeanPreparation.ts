import { buildAnnualMeanField, type AnnualMeanField } from './annualMean';
import { buildSeasonalCycle, seasonalClimateInput, seasonalSupport, type SeasonalClimateInput } from './seasonalClimate';
import type { Characterization } from './types';

/** Keep the expensive resolved prototype out of ordinary surface bakes. */
export function supportsAnnualMean(input: SeasonalClimateInput): boolean {
  return seasonalSupport(input) === null &&
    !(input.rotation.locked && input.rotation.lockTarget !== 'planet') && input.rotation.spinOrbitResonance !== '3:2';
}

/** Distant-bake worker preparation. It uses the same forcing schedule and
 * point solver and convergence gate as the focus worker.
 * No system/catalog generation or terrain vertex calls this solve. */
export function prepareAnnualMean(physical: Characterization): AnnualMeanField | undefined {
  const input = seasonalClimateInput(physical);
  if (typeof input === 'string' || !supportsAnnualMean(input)) return undefined;
  const result = buildSeasonalCycle(input);
  if (result.status !== 'ready') return undefined;
  const mean = buildAnnualMeanField(result.cycle);
  return mean.status === 'ready' ? mean.field : undefined;
}
