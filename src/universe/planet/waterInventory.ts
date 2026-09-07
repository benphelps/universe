import { EARTH_MASS, EARTH_RADIUS } from '../../core/physics/constants';
import type { PlanetBulk } from './types';
import { waterSaturationPa } from './waterPhase';

export const WATER_MOLECULAR_MASS = 18.0153;
export interface WaterReservoir {
  totalKgM2: number;
  /** Unresolved partition is deliberately distinct from condensed water. */
  status: 'dilute' | 'dry' | 'no-surface-air' | 'temperature-limit' | 'steam-limit';
  vaporKgM2?: number;
  condensedKgM2?: number;
  relativeHumidity?: number;
}

export function waterColumnInventory(massFraction: number, bulk: PlanetBulk): number {
  return Math.max(0, massFraction) * bulk.massEarth * EARTH_MASS / (4 * Math.PI * (bulk.radiusEarth * EARTH_RADIUS) ** 2);
}

/** A well-mixed, fixed-humidity reference reservoir, not a weather or
 * escape calculation. Partial pressure is not column weight: molecular
 * mixing redistributes the supporting pressure of all species. */
export function partitionWater(totalKgM2: number, dryPressurePa: number, dryMolecularMass: number,
  gravityMs2: number, temperatureK: number, humidity = 0.6): WaterReservoir & { weightPa: number; partialPa: number } {
  const base = { totalKgM2, weightPa: 0, partialPa: 0 };
  if (!(totalKgM2 > 0)) return { ...base, status: 'dry', vaporKgM2: 0, condensedKgM2: 0, relativeHumidity: 0 };
  if (!(dryPressurePa > 0 && dryMolecularMass > 0)) return { ...base, status: 'no-surface-air' };
  const saturation = waterSaturationPa(temperatureK);
  if (saturation === null) return { ...base, status: 'temperature-limit' };
  const requestedPartial = Math.min(1, Math.max(0, humidity)) * saturation;
  const epsilon = WATER_MOLECULAR_MASS / dryMolecularMass;
  const a = dryPressurePa - requestedPartial;
  const root = Math.sqrt(a * a + 4 * requestedPartial * dryPressurePa * epsilon);
  const requestedWeight = a >= 0 ? 2 * requestedPartial * dryPressurePa * epsilon / (root + a) : (root - a) * 0.5;
  const weightPa = Math.min(totalKgM2 * gravityMs2, requestedWeight);
  const pressure = dryPressurePa + weightPa;
  const fraction = weightPa / (epsilon * dryPressurePa + weightPa);
  // Do not silently extrapolate a dilute-water atmosphere into steam.
  if (fraction > 0.1) return { ...base, status: 'steam-limit' };
  const vaporKgM2 = weightPa / gravityMs2, partialPa = fraction * pressure;
  return { ...base, status: 'dilute', vaporKgM2, condensedKgM2: Math.max(0, totalKgM2 - vaporKgM2),
    relativeHumidity: saturation > 0 ? partialPa / saturation : 0, weightPa, partialPa };
}
