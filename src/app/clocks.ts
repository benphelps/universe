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
/** How long one turn of a clock takes on screen, detent by detent,
 *  slowest first. */
export const DETENT_SECONDS = [3600, 1800, 900, 300, 60, 30, 15, 5, 1] as const;
/** The detent a focus opens on, and the one its clock is labelled at. */
export const OPENING_SECONDS = 30;
/** Two detents this close in rate are one; the labelled one wins. */
const SAME_RATE = 1.25;

/** A stop on the slider: a rate, and the clock and pace it names. */
export interface Detent {
  rate: number;
  /** Null for real time. */
  clock: Clock | null;
  /** One turn of the clock in this many seconds on screen; null for real time. */
  seconds: number | null;
}

/**
 * The slider's stops for a focus: real time first, then every clock's
 * ladder of paces merged into one ascending run, so the slider turns
 * through the slow paces of a slow clock and on into the fast paces of
 * a fast one without a gap or a doubling. Stops are spaced evenly on
 * the slider whatever their rates, which is what keeps real time and
 * the crawl above it from taking most of its length.
 */
export function detentsFor(clocks: Clock[]): Detent[] {
  const ladder: Detent[] = [];
  for (const clock of clocks) {
    if (clock.periodDays === null) continue;
    for (const seconds of DETENT_SECONDS) {
      ladder.push({ rate: clock.periodDays / seconds, clock, seconds });
    }
  }
  ladder.sort((a, b) => a.rate - b.rate);
  const detents: Detent[] = [{ rate: REAL_RATE, clock: null, seconds: null }];
  for (const next of ladder) {
    const last = detents[detents.length - 1];
    if (next.rate / last.rate < SAME_RATE) {
      if (next.seconds === OPENING_SECONDS && last.seconds !== OPENING_SECONDS) {
        detents[detents.length - 1] = next;
      }
      continue;
    }
    detents.push(next);
  }
  return detents;
}

/** Where a focus opens: its quickest clock turning once in half a
 *  minute — a day at a world, the innermost orbit on a map. */
export function openingIndex(detents: Detent[]): number {
  let quickest = -1;
  detents.forEach((detent, index) => {
    if (detent.seconds !== OPENING_SECONDS) return;
    if (quickest < 0 || (detent.clock?.periodDays ?? 0) < (detents[quickest].clock?.periodDays ?? 0)) {
      quickest = index;
    }
  });
  return Math.max(0, quickest);
}

/** The rate as a multiple of real time, short: ×1, ×86, ×4.3k, ×12M. */
export function formatMultiplier(rate: number): string {
  const m = rate * SECONDS_PER_DAY;
  if (m < 1.5) return '×1';
  if (m < 1000) return `×${Math.round(m)}`;
  if (m < 1e6) return `×${(m / 1e3).toFixed(m < 1e4 ? 1 : 0)}k`;
  if (m < 1e9) return `×${(m / 1e6).toFixed(m < 1e7 ? 1 : 0)}M`;
  return `×${(m / 1e9).toFixed(m < 1e10 ? 1 : 0)}G`;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}

/** What a stop means here: "a day every 15 s", "an orbit every 5 min",
 *  or real time. */
export function describeDetent(detent: Detent): string {
  if (!detent.clock || detent.seconds === null) return 'real time';
  const article = /^[aeiou]/.test(detent.clock.label) ? 'an' : 'a';
  return `${article} ${detent.clock.label} every ${formatSeconds(detent.seconds)}`;
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
