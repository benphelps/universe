import type { OrbitalElements } from '../../core/math/orbit';
import { mu as muOf, type Mu } from '../../core/physics/units';
import { AU, G, SOLAR_MASS, EARTH_MASS } from '../../core/physics/constants';
import { rayleigh } from '../../core/rng/distributions';
import { deriveSeed, seedToHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { GalacticPosition } from '../galaxy/density';
import { viewpointForSeed } from '../galaxy/sectors';
import { generateMoons } from '../moon/generate';
import { characterizePlanet } from '../planet/characterize';
import { generateRings } from '../rings/generate';
import { generateComets } from '../smallbody/comets';
import { generateStar } from '../star/generate';
import { radiusFromLT, msLuminosity } from '../star/mainSequence';
import type { Star } from '../star/types';
import { layoutPlanets } from './architecture';
import { generateBelts, generateReservoirs } from './belts';
import { generateDisk } from './disk';
import { assignElements } from './elements';
import { pTypeCriticalAu, sTypeCriticalAu } from './holmanWiegert';
import { filterStable, type StablePlanet } from './stability';
import type { Planet, StarSystem, StellarCompanion, SystemConfiguration } from './types';
import { computeZones } from './zones';

const SOLAR_RADIUS_AU = 0.00465;
const DEG = Math.PI / 180;
const PLANET_LETTERS = 'bcdefghijklmnopq';

/**
 * Complete planetary system for a seed. The star is generated from the
 * same seed, so a given seed names the same star in every viewer.
 * Catalog stars pass their true galactic position — the population
 * (age, metallicity) and everything downstream is local to it; bare
 * seeds settle at the seed-derived locale.
 */
export function generateSystem(seed: bigint, localePc?: GalacticPosition): StarSystem {
  const locale = localePc ?? viewpointForSeed(seed);
  const star = generateStar(seed, { localePc: locale });
  const rng = new Rng(deriveSeed(seed, 'system'));

  const companions = companionOrbits(rng.fork('companions'), star);
  const { configuration, centralMassSolar, innerLimitAu, outerLimitAu, centralLuminosity } =
    resolveConfiguration(star, companions);

  const disk = generateDisk(rng.fork('disk'), star);
  const slots = layoutPlanets(
    rng.fork('architecture'),
    centralMassSolar,
    star.feH,
    disk,
    innerLimitAu,
    Math.min(outerLimitAu, disk.outerAu),
  );
  const elements = assignElements(rng.fork('elements'), slots);
  let stable = filterStable(slots, elements, centralMassSolar);
  stable = applyStellarEndState(star, stable);

  const zones = computeZones(centralLuminosity, star.tEff, star.ageGyr, centralMassSolar);
  const planets: Planet[] = stable.map(({ slot, elements: el }, i) => {
    const planet: Planet = {
      name: `${star.designation} ${PLANET_LETTERS[Math.min(i, PLANET_LETTERS.length - 1)]}`,
      class: slot.class,
      elements: el,
      inHabitableZone:
        el.semiMajorAxis / AU >= zones.habitableInnerAu &&
        el.semiMajorAxis / AU <= zones.habitableOuterAu,
      tidallyLocked: el.semiMajorAxis / AU < zones.tidalLockAu,
      resonanceWithInner: slot.resonanceWithInner,
      physical: characterizePlanet(deriveSeed(seed, 'planet', i), slot.class, slot.massEarth, el, {
        star,
        centralLuminosity,
        mu: muOf(G * (centralMassSolar * SOLAR_MASS + slot.massEarth * EARTH_MASS)),
        zones,
      }),
      moons: [],
      rings: null,
    };
    planet.moons = generateMoons(deriveSeed(seed, 'moons', i), planet, {
      star,
      centralLuminosity,
      zones,
    });
    planet.rings = generateRings(
      rng.fork('rings', i),
      planet,
      planet.moons,
      zones,
      el.semiMajorAxis / AU,
    );
    return planet;
  });

  const reservoirs = generateReservoirs(rng.fork('reservoirs'), stable);
  return {
    seedHex: seedToHex(seed),
    localePc: locale,
    star,
    companions,
    configuration,
    centralMassSolar,
    planets,
    belts: generateBelts(rng.fork('belts'), stable),
    comets: generateComets(rng.fork('comets'), star.designation, reservoirs),
    reservoirs,
    zones,
  };
}

/** Gravitational parameter for planet propagation around the system center. */
export function planetMu(system: StarSystem, planet: Planet): Mu {
  return muOf(G * (system.centralMassSolar * SOLAR_MASS + planet.physical.bulk.massEarth * EARTH_MASS));
}

/** Full orbits for stellar companions (mildly inclined to the planet plane). */
function companionOrbits(rng: Rng, star: Star): StellarCompanion[] {
  return star.companions.map(({ star: companion, orbit }) => ({
    star: companion,
    elements: {
      semiMajorAxis: orbit.semiMajorAxisAu * AU,
      eccentricity: orbit.eccentricity,
      inclination: rayleigh(rng, 10 * DEG),
      longitudeOfAscendingNode: rng.range(0, 2 * Math.PI),
      argumentOfPeriapsis: rng.range(0, 2 * Math.PI),
      meanAnomalyAtEpoch: rng.range(0, 2 * Math.PI),
      epoch: 0,
    },
  }));
}

interface Configuration {
  configuration: SystemConfiguration;
  centralMassSolar: number;
  centralLuminosity: number;
  innerLimitAu: number;
  outerLimitAu: number;
}

/**
 * Binary geometry decides where planets can live (Holman–Wiegert):
 * a close pair hosts circumbinary (P-type) planets beyond the critical
 * radius; a wide companion truncates the circumstellar (S-type) region.
 */
function resolveConfiguration(star: Star, companions: StellarCompanion[]): Configuration {
  if (companions.length === 0) {
    return {
      configuration: 'single',
      centralMassSolar: star.mass,
      centralLuminosity: star.luminosity,
      innerLimitAu: 0.02,
      outerLimitAu: Infinity,
    };
  }

  const sorted = [...companions].sort(
    (a, b) => a.elements.semiMajorAxis - b.elements.semiMajorAxis,
  );
  const closest = sorted[0];
  const aBinAu = closest.elements.semiMajorAxis / AU;
  const eBin = closest.elements.eccentricity;
  const mu = closest.star.mass / (star.mass + closest.star.mass);

  if (aBinAu * (1 - eBin) < 0.6) {
    const outer = sorted[1];
    return {
      configuration: 'p-type',
      centralMassSolar: star.mass + closest.star.mass,
      centralLuminosity: star.luminosity + closest.star.luminosity,
      innerLimitAu: pTypeCriticalAu(aBinAu, eBin, mu) * 1.1,
      outerLimitAu: outer
        ? sTypeCriticalAu(
            outer.elements.semiMajorAxis / AU,
            outer.elements.eccentricity,
            outer.star.mass / (star.mass + closest.star.mass + outer.star.mass),
          )
        : Infinity,
    };
  }

  const outerLimitAu = Math.min(
    ...sorted.map((c) =>
      sTypeCriticalAu(
        c.elements.semiMajorAxis / AU,
        c.elements.eccentricity,
        c.star.mass / (star.mass + c.star.mass),
      ),
    ),
  );
  return {
    configuration: 's-type',
    centralMassSolar: star.mass,
    centralLuminosity: star.luminosity,
    innerLimitAu: 0.02,
    outerLimitAu,
  };
}

/** Zero-albedo equilibrium temperature above which a planet photo-evaporates. */
const EVAPORATION_LIMIT_K = 3000;

/**
 * Post-main-sequence consequences: giant envelopes engulf close planets
 * (white-dwarf systems also keep the orbital expansion from mass loss),
 * and supernovae sterilize the system entirely. Around very luminous
 * stars the innermost orbits are too hot for any planet to survive.
 */
function applyStellarEndState(star: Star, planets: StablePlanet[]): StablePlanet[] {
  if (star.stage === 'neutron-star' || star.stage === 'black-hole') return [];

  planets = planets.filter(({ elements }) => {
    const aAu = elements.semiMajorAxis / AU;
    const rawEquilibriumK = 278.6 * (star.luminosity / aAu ** 2) ** 0.25;
    return rawEquilibriumK < EVAPORATION_LIMIT_K;
  });

  let engulfRadiusAu = 2 * star.radius * SOLAR_RADIUS_AU;
  let expansion = 1;
  if (star.stage === 'white-dwarf') {
    const agbLuminosity = Math.max(5000, 2.2 * 1.3 * msLuminosity(star.massInitial));
    engulfRadiusAu = 1.3 * radiusFromLT(agbLuminosity, 3000) * SOLAR_RADIUS_AU;
    expansion = star.massInitial / star.mass;
  }

  return planets
    .filter(({ elements }) => {
      const periAu = (elements.semiMajorAxis / AU) * (1 - elements.eccentricity);
      return periAu > engulfRadiusAu;
    })
    .map((p) => {
      if (expansion === 1) return p;
      p.slot.aAu *= expansion;
      p.elements.semiMajorAxis *= expansion;
      return p;
    });
}

