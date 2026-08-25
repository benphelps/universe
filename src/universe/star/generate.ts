import { blackbodyChromaticity, blackbodyLinearRgb } from '../../core/color/blackbody';
import { deriveSeed, seedToHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { GalacticPosition } from '../galaxy/density';
import { metallicityFor, populationFromUnit } from '../galaxy/population';
import { viewpointForSeed } from '../galaxy/sectors';
import { computeActivity } from './activity';
import { classifyVariability } from './variability';
import { evolve } from './evolution';
import { ageUnitOf, initialMassOf } from './identity';
import { generateCompanionSpecs } from './multiplicity';
import { spectralType } from './classification';
import type { Star, StellarPopulation } from './types';

export interface StarGenOptions {
  /** Fixed zero-age mass instead of an IMF draw, M☉. */
  massInitial?: number;
  ageGyr?: number;
  feH?: number;
  population?: StellarPopulation;
  /** Companion generation is disabled for companion stars themselves. */
  withCompanions?: boolean;
  /** The star's true galactic position (catalog stars carry theirs
   *  through travel); bare seeds fall back to the seed-derived locale. */
  localePc?: GalacticPosition;
}

/**
 * Complete star (with companions) from a seed. Mass, age, and component
 * resolve from the seed's identity bits through the IMF and the galactic
 * population mix at the seed's locale — thin disk, thick disk, or halo
 * by local density — unless overridden.
 */
export function generateStar(seed: bigint, options: StarGenOptions = {}): Star {
  const rng = new Rng(seed);
  let ageGyr = options.ageGyr;
  let feH = options.feH;
  let population = options.population;
  if (ageGyr === undefined || feH === undefined) {
    const locale = options.localePc ?? viewpointForSeed(seed);
    const draw = populationFromUnit(ageUnitOf(seed), locale);
    ageGyr ??= draw.ageGyr;
    feH ??= metallicityFor(rng, draw, locale);
    population ??= draw.component;
  }
  population ??= feH < -1 ? 'halo' : feH < -0.35 ? 'thick-disk' : 'thin-disk';
  const massInitial = options.massInitial ?? initialMassOf(seed);

  const phys = evolve(massInitial, ageGyr);
  const dark = phys.stage === 'black-hole';

  const star: Star = {
    ...phys,
    seedHex: seedToHex(seed),
    designation: `SIM-${seedToHex(seed).slice(-8).toUpperCase()}`,
    massInitial,
    ageGyr,
    feH,
    population,
    spectralType: spectralType(phys),
    chromaticity: dark ? { x: 0.3127, y: 0.329 } : blackbodyChromaticity(phys.tEff),
    linearRgb: dark ? [0, 0, 0] : blackbodyLinearRgb(phys.tEff),
    activity: computeActivity(rng.fork('activity'), phys, ageGyr),
    variability: classifyVariability(rng.fork('variability'), phys, feH),
    companions: [],
  };

  if (options.withCompanions !== false) {
    const specs = generateCompanionSpecs(rng.fork('multiplicity'), massInitial);
    star.companions = specs.map((spec, i) => ({
      orbit: spec.orbit,
      star: generateStar(deriveSeed(seed, 'companion', i), {
        massInitial: spec.massSolar,
        ageGyr,
        feH,
        population,
        withCompanions: false,
      }),
    }));
  }

  return star;
}
