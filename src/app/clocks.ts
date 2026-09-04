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

const SECONDS_PER_DAY = 86400;

/** Real time, in the simulation's own unit: days per screen second. */
export const REAL_RATE = 1 / SECONDS_PER_DAY;
/** The fastest the slider goes: a hundred million times real time. */
export const MAX_RATE = REAL_RATE * 1e8;
/** A clock's landmark on the rate axis is where one turn of it takes
 *  this long on screen. */
export const LANDMARK_SECONDS = 10;
/** A focus opens with its quickest clock turning once in this long —
 *  a day at a world, the innermost orbit on a map. */
const OPENING_SECONDS = 30;

/** Where a rate stands on the slider, 0 at real time and 1 at the top. */
export function ratePosition(rate: number): number {
  return Math.min(1, Math.max(0, Math.log10(rate / REAL_RATE) / Math.log10(MAX_RATE / REAL_RATE)));
}

export function rateAtPosition(position: number): number {
  const t = Math.min(1, Math.max(0, position));
  return REAL_RATE * Math.pow(MAX_RATE / REAL_RATE, t);
}

/** The rate a focus opens at: its quickest clock, or real time. */
export function openingRate(clocks: Clock[]): number {
  const turning = clocks.filter((clock) => clock.periodDays !== null);
  if (turning.length === 0) return REAL_RATE;
  return Math.min(...turning.map((clock) => clock.periodDays as number)) / OPENING_SECONDS;
}

/** The rate as a multiple of real time, short: ×1, ×86, ×4.3k, ×12M. */
export function formatMultiplier(rate: number): string {
  const m = rate * SECONDS_PER_DAY;
  if (m < 1.5) return '×1';
  if (m < 1000) return `×${Math.round(m)}`;
  if (m < 1e6) return `×${(m / 1e3).toFixed(m < 1e4 ? 1 : 0)}k`;
  return `×${(m / 1e6).toFixed(m < 1e7 ? 1 : 0)}M`;
}

function formatSeconds(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < SECONDS_PER_DAY) return `${(seconds / 3600).toFixed(1)} h`;
  return `${Math.round(seconds / SECONDS_PER_DAY)} d`;
}

/**
 * What a rate means here: the largest of the focus's clocks that still
 * turns inside ten minutes, and how long one turn takes — "a day every
 * 17 s", "a year every 4 min" — so the phrase stays legible at every
 * speed instead of counting years a second. Real time says so; a place
 * where nothing turns has nothing to say.
 */
export function describeRate(rate: number, clocks: Clock[]): string {
  if (rate <= REAL_RATE * 1.05) return 'real time';
  const turning = clocks
    .filter((clock) => clock.periodDays !== null)
    .map((clock) => ({ label: clock.label, seconds: (clock.periodDays as number) / rate }))
    .sort((a, b) => a.seconds - b.seconds);
  if (turning.length === 0) return 'nothing here turns';
  let pick = turning[0];
  for (const clock of turning) if (clock.seconds <= 600) pick = clock;
  const article = /^[aeiou]/.test(pick.label) ? 'an' : 'a';
  return `${article} ${pick.label} every ${formatSeconds(pick.seconds)}`;
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
