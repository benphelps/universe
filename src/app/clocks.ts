import { orbitalPeriod } from '../core/math/orbit';
import { galacticNucleus } from '../universe/galaxy/nucleus';
import { asteroidDesignation } from '../universe/smallbody/notable';
import { companionPlanetMu, planetMu } from '../universe/system/generate';
import { host, type AppSnapshot } from './store';
import { cloudTitle } from './ui/nebulaPanel';

/**
 * The clock of a focus: the one motion you watch there, and how long
 * it takes to turn once. At a body it is the body's own turning — a
 * world's day, a star's rotation — since from the ground or a close
 * orbit that is the turning you see; on a map it is an orbit, the
 * innermost planet's or the core's inner edge. The rate of the
 * simulation is chosen by saying how long one turn should take on
 * screen, so the same choice reads as ×2k at a world and ×4M on a map.
 */
export interface Clock {
  label: string;
  /** One turn, days. */
  periodDays: number;
}

const SECONDS_PER_DAY = 86400;

/** Real time, in the simulation's own unit: days per screen second. */
export const REAL_RATE = 1 / SECONDS_PER_DAY;
/** How long one turn of the clock takes on screen, stop by stop,
 *  slowest first. */
export const DETENT_SECONDS = [3600, 1800, 900, 300, 180, 120, 60, 30, 15, 5, 1] as const;
/** The stop a focus opens on. */
export const OPENING_SECONDS = 30;

/** A stop on the slider: a rate, and the clock and pace it names. */
export interface Detent {
  rate: number;
  /** Null for real time. */
  clock: Clock | null;
  /** One turn of the clock in this many seconds on screen; null for real time. */
  seconds: number | null;
}

/**
 * The slider's stops for a focus: real time, then the clock's run of
 * paces from a turn an hour down to a turn a second. The stops are
 * spaced evenly on the slider, so it reads as "how fast does the
 * clock turn", not as a number line; the rate itself is whatever the
 * pace names. Only real time where nothing turns.
 */
export function detentsFor(clock: Clock | null): Detent[] {
  const detents: Detent[] = [{ rate: REAL_RATE, clock: null, seconds: null }];
  if (clock) {
    for (const seconds of DETENT_SECONDS) {
      detents.push({ rate: clock.periodDays / seconds, clock, seconds });
    }
  }
  return detents;
}

/** Where a focus opens: its clock turning once in half a minute. */
export function openingIndex(detents: Detent[]): number {
  const index = detents.findIndex((detent) => detent.seconds === OPENING_SECONDS);
  return Math.max(0, index);
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

/** A pace in words: "every hour", "every 30 minutes", "every second". */
function everyPace(seconds: number): string {
  const unit = seconds >= 3600 ? 'hour' : seconds >= 60 ? 'minute' : 'second';
  const count = seconds >= 3600 ? seconds / 3600 : seconds >= 60 ? seconds / 60 : seconds;
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}

/** What a stop means here: "a day every 15 seconds", "an orbit every
 *  5 minutes", or real time. */
export function describeDetent(detent: Detent): string {
  if (!detent.clock || detent.seconds === null) return 'real time';
  const article = /^[aeiou]/.test(detent.clock.label) ? 'an' : 'a';
  return `${article} ${detent.clock.label} ${everyPace(detent.seconds)}`;
}

/** The clock of a focus and whose it is; no clock where nothing turns. */
export interface FocusClock {
  owner: string;
  clock: Clock | null;
}

export function clockFor(snap: AppSnapshot): FocusClock {
  if (snap.coreView) {
    return {
      owner: 'Galactic Core',
      clock: { label: 'orbit', periodDays: galacticNucleus().iscoPeriodS / SECONDS_PER_DAY },
    };
  }
  if (snap.cloud) return { owner: cloudTitle(snap.cloud.name, snap.cloud.kind), clock: null };

  const { star, planets, companion } = host(snap);
  if (snap.viewMode === 'galaxy') return { owner: star.designation, clock: null };

  const rotation: Clock = { label: 'rotation', periodDays: star.activity.rotationPeriodDays };
  if (snap.viewMode === 'system') {
    // The map turns by its innermost planet: the one lap you can
    // always follow, every other orbit slower.
    const innermost = planets.reduce<number | null>((shortest, planet) => {
      const days =
        orbitalPeriod(
          companion ? companionPlanetMu(companion, planet) : planetMu(snap.system, planet),
          planet.elements.semiMajorAxis,
        ) / SECONDS_PER_DAY;
      return shortest === null || days < shortest ? days : shortest;
    }, null);
    return {
      owner: `${star.designation} system`,
      clock: innermost === null ? rotation : { label: 'orbit', periodDays: innermost },
    };
  }
  if (snap.viewMode === 'star' || snap.planetFocus === 'empty') {
    return { owner: star.designation, clock: rotation };
  }

  if (snap.planetFocus === 'asteroid') {
    const asteroid = snap.asteroids[snap.planetIndex - planets.length];
    return {
      owner: asteroidDesignation(asteroid),
      clock: { label: 'day', periodDays: asteroid.spinPeriodHours / 24 },
    };
  }
  const planet = planets[snap.planetIndex];
  if (snap.planetFocus === 'moon') {
    const moon = planet.moons[snap.moonIndex];
    return { owner: moon.name, clock: { label: 'day', periodDays: moon.physical.rotation.periodHours / 24 } };
  }
  return { owner: planet.name, clock: { label: 'day', periodDays: planet.physical.rotation.periodHours / 24 } };
}
