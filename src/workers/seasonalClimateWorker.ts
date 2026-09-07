import { buildSeasonalCycle, type SeasonalClimateInput } from '../universe/planet/seasonalClimate';
import { buildSeasonalSurface } from '../universe/planet/seasonalSurface';
import { buildAnnualMeanField } from '../universe/planet/annualMean';

self.onmessage = (event: MessageEvent<SeasonalClimateInput>) => {
  const result = buildSeasonalCycle(event.data);
  const transfers: ArrayBuffer[] = [];
  if (result.status === 'ready') {
    result.cycle.annualMean = buildAnnualMeanField(result.cycle);
    if (event.data.surfaceOverlay) {
      result.cycle.surface = buildSeasonalSurface(result.cycle);
      if (result.cycle.surface.status === 'ready') transfers.push(result.cycle.surface.field.temperatureK.buffer as ArrayBuffer);
    }
    transfers.push(result.cycle.temperatureK.buffer as ArrayBuffer, result.cycle.forcingSamples.buffer as ArrayBuffer);
    if (result.cycle.annualMean.status === 'ready') {
      const mean = result.cycle.annualMean.field;
      transfers.push(mean.angles.buffer as ArrayBuffer, mean.ratios.buffer as ArrayBuffer, mean.fourthK4.buffer as ArrayBuffer);
    }
  }
  (self as unknown as Worker).postMessage(result, transfers);
};
