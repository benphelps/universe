import type { PlanetForcing, StellarForcing } from './illumination';
import type { OrbitalElements } from '../../core/math/orbit';
import { orbitalPeriod } from '../../core/math/orbit';
import { AU } from '../../core/physics/constants';
import { seedToHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Star } from '../star/types';
import type { PlanetClass, SystemZones } from '../system/types';
import { computeAppearance } from './appearance';
import { computeAtmosphere, finalizeAtmosphere } from './atmosphere';
import { computeBulk } from './bulk';
import { computeClimate } from './climate';
import { computeInterior, sampleIronCoreFraction } from './interior';
import { computeRotation, solarDayHours } from './rotation';
import type { Characterization } from './types';
import type { Mu } from '../../core/physics/units';

export interface CharacterizeContext {
  star: Star;
  stellarForcing?: StellarForcing;
  centralLuminosity: number;
  /** Gravitational parameter for this planet's orbit, m³/s². */
  mu: Mu;
  zones: SystemZones;
}

/**
 * Full physical characterization of a planet from its seed, system slot,
 * and stellar context. Stages feed forward: spin → bulk → interior →
 * atmosphere → climate → appearance, with a biosphere able to oxygenate
 * the atmosphere at the end.
 */
export function characterizePlanet(
  seed: bigint,
  planetClass: PlanetClass,
  massEarth: number,
  elements: OrbitalElements,
  context: CharacterizeContext,
): Characterization {
  const rng = new Rng(seed);
  const { star, centralLuminosity, zones } = context;
  const aAu = elements.semiMajorAxis / AU;

  // Zero-albedo-prior equilibrium temperature for the early stages.
  const rawEquilibriumK = 278.6 * (centralLuminosity / aAu ** 2) ** 0.25 * 0.7 ** 0.25;

  const rotation = computeRotation(
    rng.fork('rotation'),
    planetClass,
    aAu,
    elements.eccentricity,
    zones.tidalLockAu,
    context.mu,
    elements.semiMajorAxis,
  );
  const ironCoreFraction = sampleIronCoreFraction(rng.fork('core'), planetClass, star.feH);
  rotation.lockTarget = rotation.locked ? 'star' : undefined;
  rotation.solarDayHours = solarDayHours(rotation, orbitalPeriod(context.mu, elements.semiMajorAxis) / 3600);
  const bulk = computeBulk(
    rng.fork('bulk'),
    massEarth,
    planetClass,
    rawEquilibriumK,
    rotation.periodHours,
    ironCoreFraction,
  );
  let interior = computeInterior(
    rng.fork('interior'),
    planetClass,
    bulk,
    rotation,
    ironCoreFraction,
    star.ageGyr,
    aAu,
    elements.eccentricity,
  );
  let atmosphere = computeAtmosphere(
    rng.fork('atmosphere'),
    planetClass,
    bulk,
    interior,
    star,
    rawEquilibriumK,
    zones.frostLineAu,
    zones.habitableInnerAu,
    aAu,
  );
  const forcing: PlanetForcing = { ...(context.stellarForcing ?? { sources: [{ luminositySolar: centralLuminosity, path: [] }], origin: [] }),
    orbit: { elements, mu: context.mu } };
  const climate = computeClimate(
    rng.fork('climate'),
    planetClass,
    atmosphere,
    bulk,
    interior,
    rotation,
    star.linearRgb,
    centralLuminosity,
    aAu,
    star.ageGyr,
    forcing,
  );
  // Geological heat and stellar heating enter independently, but either can
  // leave the observable surface molten. Reconcile that final thermodynamic
  // state before appearance and terrain are derived from it.
  if (climate.hydrosphere === 'magma' && (climate.surfaceBackgroundK ?? 0) >= 1300 && interior.regime !== 'gas') {
    interior = { ...interior, regime: 'magma' };
  }
  atmosphere = finalizeAtmosphere(atmosphere, climate, bulk);

  return {
    seedHex: seedToHex(seed),
    forcing,
    bulk,
    interior,
    rotation,
    atmosphere,
    climate,
    appearance: computeAppearance(
      rng.fork('appearance'),
      planetClass,
      bulk,
      atmosphere,
      climate,
      interior,
      rotation,
      star.ageGyr,
    ),
  };
}
