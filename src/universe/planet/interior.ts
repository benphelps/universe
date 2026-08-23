import type { Rng } from '../../core/rng/rng';
import type { PlanetClass } from '../system/types';
import type { GeologicalRegime, PlanetBulk, PlanetInterior, PlanetRotation } from './types';

/**
 * Heat budget and its consequences. Radiogenic heating decays with a
 * ~3 Gyr effective half-life; tidal heating scales as e²/a⁶ (dominant
 * only for close eccentric orbits); giants keep primordial heat.
 * The dynamo needs a convecting conductive layer plus rotation.
 */
/** Iron core mass fraction, drawn ahead of bulk (compactness depends on it). */
export function sampleIronCoreFraction(rng: Rng, planetClass: PlanetClass, feH: number): number {
  if (rng.bool(0.05) && planetClass === 'rocky') return rng.range(0.55, 0.7);
  return Math.min(0.6, Math.max(0.1, rng.normal(0.33 + 0.05 * feH, 0.07)));
}

export function computeInterior(
  rng: Rng,
  planetClass: PlanetClass,
  bulk: PlanetBulk,
  rotation: PlanetRotation,
  ironCoreFraction: number,
  ageGyr: number,
  aAu: number,
  eccentricity: number,
): PlanetInterior {
  const gas = planetClass === 'gas-giant' || planetClass === 'ice-giant';
  const areaRel = bulk.radiusEarth ** 2;

  // Earth-calibrated: ~0.09 W/m² at 1 M⊕, 4.6 Gyr.
  const radiogenic = (0.14 * bulk.massEarth * 2 ** (-ageGyr / 3)) / areaRel;
  // Star-raised tides matter only for close-in eccentric orbits (a ≲ 0.1 AU).
  const tidal = Math.min(
    30,
    (1e-5 * eccentricity ** 2 * bulk.radiusEarth ** 3) / aAu ** 6 / areaRel,
  );
  const primordial = gas ? 0.3 * bulk.massEarth ** 0.5 : 0;
  const heatFluxWm2 = radiogenic + tidal + primordial;

  const regime = geologicalRegime(rng, planetClass, bulk, heatFluxWm2);

  return {
    ironCoreFraction,
    heatFluxWm2,
    regime,
    magneticFieldRelEarth: magneticField(rng, planetClass, bulk, rotation, heatFluxWm2, ironCoreFraction),
  };
}

function geologicalRegime(
  rng: Rng,
  planetClass: PlanetClass,
  bulk: PlanetBulk,
  heatFluxWm2: number,
): GeologicalRegime {
  if (planetClass === 'gas-giant' || planetClass === 'ice-giant' || planetClass === 'mini-neptune') {
    return 'gas';
  }
  if (heatFluxWm2 > 2) return 'magma';
  if (heatFluxWm2 < 0.02 || bulk.massEarth < 0.3) return 'dead';
  return rng.bool(0.55) ? 'active-tectonics' : 'stagnant-lid';
}

function magneticField(
  rng: Rng,
  planetClass: PlanetClass,
  bulk: PlanetBulk,
  rotation: PlanetRotation,
  heatFluxWm2: number,
  ironCoreFraction: number,
): number {
  const spinFactor = Math.sqrt(24 / Math.max(rotation.periodHours, 1));
  if (planetClass === 'gas-giant') return rng.range(8, 20) * spinFactor;
  if (planetClass === 'ice-giant' || planetClass === 'mini-neptune') {
    return rng.range(0.3, 1.5) * spinFactor;
  }
  // Rocky dynamo: dies with the heat flux that drives core convection.
  const convection = Math.max(0, heatFluxWm2 - 0.03) * bulk.massEarth;
  if (convection <= 0) return 0;
  return Math.min(5, Math.sqrt(convection * ironCoreFraction * 10) * spinFactor * rng.range(0.6, 1.4));
}
