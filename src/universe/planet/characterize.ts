import type { OrbitalElements } from '../../core/math/orbit';
import { AU } from '../../core/physics/constants';
import { seedToHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Star } from '../star/types';
import type { PlanetClass, SystemZones } from '../system/types';
import { computeAppearance } from './appearance';
import { computeAtmosphere, withOxygen } from './atmosphere';
import { computeBulk } from './bulk';
import { computeClimate } from './climate';
import { computeInterior, sampleIronCoreFraction } from './interior';
import { computeRotation } from './rotation';
import type { Characterization } from './types';
import type { Mu } from '../../core/physics/units';

export interface CharacterizeContext {
  star: Star;
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
  const bulk = computeBulk(
    rng.fork('bulk'),
    massEarth,
    planetClass,
    rawEquilibriumK,
    rotation.periodHours,
    ironCoreFraction,
  );
  const interior = computeInterior(
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
  const climate = computeClimate(
    rng.fork('climate'),
    planetClass,
    atmosphere,
    interior,
    rotation,
    centralLuminosity,
    aAu,
    star.ageGyr,
  );
  if (climate.biosphere) atmosphere = withOxygen(atmosphere);

  return {
    seedHex: seedToHex(seed),
    bulk,
    interior,
    rotation,
    atmosphere,
    climate,
    appearance: computeAppearance(
      rng.fork('appearance'),
      planetClass,
      atmosphere,
      climate,
      interior,
      rotation,
      star.ageGyr,
    ),
  };
}
