import { orbitalPeriod } from '../core/math/orbit';
import { mu as muOf } from '../core/physics/units';
import { EARTH_MASS, G, SOLAR_MASS } from '../core/physics/constants';
import { galacticNucleus } from '../universe/galaxy/nucleus';
import { asteroidDesignation } from '../universe/smallbody/notable';
import type { Planet } from '../universe/system/types';
import { companionPlanetMu, planetMu } from '../universe/system/generate';
import { host, type AppSnapshot } from './store';
import { cloudTitle } from './ui/nebulaPanel';

/**
 * A clock the focus carries: something that turns once in a known
 * time. The rate of the simulation is chosen by naming a clock and
 * how long one turn of it should take on screen, so the same choice
 * reads as minutes a second at a world and years a second on a map.
 */
export interface Clock {
  label: string;
  /** One turn, days; null for real time. */
  periodDays: number | null;
}

export const REAL_TIME: Clock = { label: 'real', periodDays: null };

/** How long one turn takes on screen. */
export const DURATIONS = [
  { label: '5 s', seconds: 5 },
  { label: '30 s', seconds: 30 },
  { label: '3 min', seconds: 180 },
] as const;

const SECONDS_PER_DAY = 86400;

/** The rate a clock and a duration name, days of simulation per second. */
export function rateFor(clock: Clock, seconds: number): number {
  return clock.periodDays === null ? 1 / SECONDS_PER_DAY : clock.periodDays / seconds;
}

/** The clocks of a focus: whose they are, and what turns. Real time
 *  is always first; a place where nothing turns has only that. */
export interface FocusClocks {
  owner: string;
  clocks: Clock[];
}

/** The letter a planet goes by in its system: "Zika CUPS b" → "b". */
function planetLetter(planet: Planet): string {
  return planet.name.split(' ').pop() ?? planet.name;
}

export function clocksFor(snap: AppSnapshot): FocusClocks {
  if (snap.coreView) {
    return {
      owner: 'Galactic Core',
      clocks: [
        REAL_TIME,
        { label: 'inner orbit', periodDays: galacticNucleus().iscoPeriodS / SECONDS_PER_DAY },
      ],
    };
  }
  if (snap.cloud) return { owner: cloudTitle(snap.cloud.name, snap.cloud.kind), clocks: [REAL_TIME] };

  const { star, planets, companion } = host(snap);
  if (snap.viewMode === 'galaxy') return { owner: star.designation, clocks: [REAL_TIME] };

  const yearDays = (planet: Planet): number =>
    orbitalPeriod(
      companion ? companionPlanetMu(companion, planet) : planetMu(snap.system, planet),
      planet.elements.semiMajorAxis,
    ) / SECONDS_PER_DAY;
  // The orbits a star's system turns by: its innermost and outermost
  // planets, named by their letters.
  const byOrbit = planets
    .map((planet) => ({ planet, days: yearDays(planet) }))
    .sort((a, b) => a.days - b.days);
  const orbitClocks: Clock[] = (
    byOrbit.length > 1 ? [byOrbit[0], byOrbit[byOrbit.length - 1]] : byOrbit
  ).map(({ planet, days }) => ({ label: `${planetLetter(planet)} orbit`, periodDays: days }));
  const spin: Clock = { label: 'spin', periodDays: star.activity.rotationPeriodDays };

  if (snap.viewMode === 'system') {
    return { owner: `${star.designation} system`, clocks: [REAL_TIME, ...(orbitClocks.length ? orbitClocks : [spin])] };
  }
  if (snap.viewMode === 'star' || snap.planetFocus === 'empty') {
    return { owner: star.designation, clocks: [REAL_TIME, spin, ...orbitClocks] };
  }

  if (snap.planetFocus === 'asteroid') {
    const asteroid = snap.asteroids[snap.planetIndex - planets.length];
    const mu = muOf(G * snap.system.centralMassSolar * SOLAR_MASS);
    return {
      owner: asteroidDesignation(asteroid),
      clocks: [
        REAL_TIME,
        { label: 'spin', periodDays: asteroid.spinPeriodHours / 24 },
        { label: 'orbit', periodDays: orbitalPeriod(mu, asteroid.elements.semiMajorAxis) / SECONDS_PER_DAY },
      ],
    };
  }

  const planet = planets[snap.planetIndex];
  const year: Clock = { label: 'year', periodDays: yearDays(planet) };
  const monthDays = (index: number): number => {
    const moon = planet.moons[index];
    const mu = muOf(G * (planet.physical.bulk.massEarth + moon.physical.bulk.massEarth) * EARTH_MASS);
    return orbitalPeriod(mu, moon.elements.semiMajorAxis) / SECONDS_PER_DAY;
  };
  if (snap.planetFocus === 'moon') {
    const moon = planet.moons[snap.moonIndex];
    return {
      owner: moon.name,
      clocks: [
        REAL_TIME,
        { label: 'day', periodDays: moon.physical.rotation.periodHours / 24 },
        { label: 'month', periodDays: monthDays(snap.moonIndex) },
        year,
      ],
    };
  }
  return {
    owner: planet.name,
    clocks: [
      REAL_TIME,
      { label: 'day', periodDays: planet.physical.rotation.periodHours / 24 },
      year,
      ...(planet.moons.length > 0 ? [{ label: 'month', periodDays: monthDays(0) }] : []),
    ],
  };
}
