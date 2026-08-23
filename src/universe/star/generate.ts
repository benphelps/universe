import { blackbodyChromaticity, blackbodyLinearRgb } from '../../core/color/blackbody';
import { deriveSeed, seedToHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { computeActivity } from './activity';
import { classifyVariability } from './variability';
import { evolve } from './evolution';
import { sampleInitialMass } from './imf';
import { generateCompanionSpecs } from './multiplicity';
import { spectralType } from './classification';
import type { Star } from './types';

export interface StarGenOptions {
  /** Fixed zero-age mass instead of an IMF draw, M☉. */
  massInitial?: number;
  ageGyr?: number;
  feH?: number;
  /** Companion generation is disabled for companion stars themselves. */
  withCompanions?: boolean;
}

/**
 * Complete star (with companions) from a seed. Age and metallicity default
 * to thin-disk-like draws until the galaxy level supplies them.
 */
export function generateStar(seed: bigint, options: StarGenOptions = {}): Star {
  const rng = new Rng(seed);
  const ageGyr = options.ageGyr ?? rng.range(0.1, 10);
  const feH = options.feH ?? Math.min(0.5, Math.max(-1, rng.normal(0, 0.2)));
  const massInitial = options.massInitial ?? sampleInitialMass(rng.fork('imf'));

  const phys = evolve(massInitial, ageGyr);
  const dark = phys.stage === 'black-hole';

  const star: Star = {
    ...phys,
    seedHex: seedToHex(seed),
    designation: `SIM-${seedToHex(seed).slice(0, 8).toUpperCase()}`,
    massInitial,
    ageGyr,
    feH,
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
        withCompanions: false,
      }),
    }));
  }

  return star;
}
