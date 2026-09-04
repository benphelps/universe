import { elementsToState } from '../core/math/kepler';
import { orbitalPeriod } from '../core/math/orbit';
import { DAY, EARTH_MASS, EARTH_RADIUS, G, SOLAR_RADIUS } from '../core/physics/constants';
import { mu as muOf, seconds, type Mu } from '../core/physics/units';
import { seedFromHex } from '../core/rng/hash';
import type { Neighbor } from '../universe/galaxy/neighborhood';
import type { Moon } from '../universe/moon/types';
import { companionPlanetMu, generateSystem, planetMu } from '../universe/system/generate';
import type { Planet, StarSystem, StellarCompanion } from '../universe/system/types';
import type { Star } from '../universe/star/types';
import type { AtmosphereClass } from '../universe/planet/types';

const TAU = 2 * Math.PI;
const MIN_OBSCURATION = 0.5;
const CONTACT_STEP_DAYS = 1 / 1440;
const CONTACT_LIMIT_DAYS = 1;
const ARRIVAL_LEAD_DAYS = 2 / 1440;
const MIN_ARRIVAL_ELEVATION = (10 * Math.PI) / 180;
const MAX_ARRIVAL_ELEVATION = (25 * Math.PI) / 180;
const TARGET_TRACK_ELEVATION = (20 * Math.PI) / 180;
const MIN_ECLIPSE_PRESSURE_BAR = 0.05;
/** Finder results must already be happening or begin inside this window. */
export const ECLIPSE_WINDOW_DAYS = 1;
/** A larger, cheap near-time survey keeps the strict one-day window useful. */
export const MAX_ECLIPSE_NEIGHBORS = 1024;
export const ECLIPSE_RESULT_LIMIT = 3;

interface Vec {
  x: number;
  y: number;
  z: number;
}

/** A real, visitable moon shadow in one of the catalog's systems. */
export interface EclipseResult {
  seedHex: string;
  positionPc: Neighbor['positionPc'];
  distancePc: number;
  hostIndex: number;
  planetIndex: number;
  moonIndex: number;
  starName: string;
  planetName: string;
  moonName: string;
  atmosphereClass: AtmosphereClass;
  atmospherePressureBar: number;
  /** Direct-sun readability of the atmosphere and its cloud deck, 0–1. */
  atmosphereScore: number;
  /** Maximum eclipse. */
  timeDays: number;
  /** First and last visible contact at the observing site. */
  startTimeDays: number;
  endTimeDays: number;
  /** A short lead before first contact, where travel leaves the clock. */
  arrivalTimeDays: number;
  active: boolean;
  waitDays: number;
  obscuration: number;
  kind: 'total' | 'annular' | 'partial';
  /** Planet-fixed ground direction at maximum eclipse. */
  surfaceDirection: [number, number, number];
  /** Planet-fixed direction toward the star at the arrival epoch. */
  sunDirection: [number, number, number];
}

export interface EclipseSearchProgress {
  checked: number;
  total: number;
  distancePc: number;
}

interface EclipseEvent {
  timeDays: number;
  startTimeDays: number;
  endTimeDays: number;
  arrivalTimeDays: number;
  obscuration: number;
  kind: EclipseResult['kind'];
  surfaceDirection: EclipseResult['surfaceDirection'];
  sunDirection: EclipseResult['sunDirection'];
}

interface EclipseMaximum {
  timeDays: number;
  obscuration: number;
  kind: EclipseResult['kind'];
  surfaceDirection: EclipseResult['surfaceDirection'];
}

interface Host {
  star: Star;
  planets: Planet[];
  companion: StellarCompanion | null;
  index: number;
}

const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (v: Vec): number => Math.hypot(v.x, v.y, v.z);
const scale = (v: Vec, k: number): Vec => ({ x: v.x * k, y: v.y * k, z: v.z * k });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const normalize = (v: Vec): Vec => scale(v, 1 / Math.max(length(v), 1e-30));
const cross = (a: Vec, b: Vec): Vec => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Model frame (z out of plane) into the viewer's world frame. */
const toWorld = (v: Vec): Vec => ({ x: v.x, y: v.z, z: -v.y });

/** The viewer leans the ecliptic around world Z by the body's obliquity. */
function lean(v: Vec, angle: number): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y, z: v.z };
}

function turnAroundY(v: Vec, angle: number): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
}

const tuple = (v: Vec): [number, number, number] => [v.x, v.y, v.z];

function wrapSigned(angle: number): number {
  return ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

/** The two unit axes that carry a body's perifocal x/y into the viewer. */
function orbitAxes(moon: Moon): { p: Vec; q: Vec; n: Vec } {
  const el = moon.elements;
  const cO = Math.cos(el.longitudeOfAscendingNode);
  const sO = Math.sin(el.longitudeOfAscendingNode);
  const ci = Math.cos(el.inclination);
  const si = Math.sin(el.inclination);
  const cw = Math.cos(el.argumentOfPeriapsis);
  const sw = Math.sin(el.argumentOfPeriapsis);
  const carry = (x: number, y: number): Vec => {
    const x1 = cw * x - sw * y;
    const y1 = sw * x + cw * y;
    return toWorld({ x: cO * x1 - sO * ci * y1, y: sO * x1 + cO * ci * y1, z: si * y1 });
  };
  const p = normalize(carry(1, 0));
  const q = normalize(carry(0, 1));
  return { p, q, n: normalize(cross(p, q)) };
}

function planetSunDirection(planet: Planet, planetMuValue: Mu, timeDays: number): Vec {
  const state = elementsToState(planet.elements, planetMuValue, seconds(timeDays * DAY));
  // The host is the origin in the same relative frame the renderer uses.
  return normalize(lean(scale(toWorld(state.position), -1), planet.physical.rotation.obliquityRad));
}

function groundSpin(planet: Planet, timeDays: number): number {
  return (-TAU * 24 * timeDays) / planet.physical.rotation.periodHours;
}

function groundSunDirection(planet: Planet, planetMuValue: Mu, timeDays: number): Vec {
  return turnAroundY(planetSunDirection(planet, planetMuValue, timeDays), groundSpin(planet, timeDays));
}

function groundMoonPosition(planet: Planet, moon: Moon, moonMu: Mu, timeDays: number): Vec {
  const state = elementsToState(moon.elements, moonMu, seconds(timeDays * DAY));
  return turnAroundY(toWorld(state.position), groundSpin(planet, timeDays));
}

function meanAnomalyForTrue(trueAnomaly: number, eccentricity: number): number {
  const eccentric =
    2 *
    Math.atan2(
      Math.sqrt(1 - eccentricity) * Math.sin(trueAnomaly / 2),
      Math.sqrt(1 + eccentricity) * Math.cos(trueAnomaly / 2),
    );
  return eccentric - eccentricity * Math.sin(eccentric);
}

/** Inferior conjunction nearest a season, allowing the moving sun to settle. */
function conjunctionNear(
  planet: Planet,
  planetMuValue: Mu,
  moon: Moon,
  moonMu: Mu,
  axes: ReturnType<typeof orbitAxes>,
  referenceDays: number,
): number {
  const motion = Math.sqrt(moonMu / moon.elements.semiMajorAxis ** 3);
  let timeDays = referenceDays;
  for (let iteration = 0; iteration < 6; iteration++) {
    const sun = planetSunDirection(planet, planetMuValue, timeDays);
    const trueAnomaly = Math.atan2(dot(sun, axes.q), dot(sun, axes.p));
    const target = meanAnomalyForTrue(trueAnomaly, moon.elements.eccentricity);
    const current =
      moon.elements.meanAnomalyAtEpoch +
      motion * (timeDays * DAY - moon.elements.epoch);
    timeDays += wrapSigned(target - current) / motion / DAY;
  }
  return timeDays;
}

/** Fraction of the stellar disc hidden by the moon at the best point on the planet. */
function discObscuration(starRadius: number, moonRadius: number, separation: number): number {
  if (separation >= starRadius + moonRadius) return 0;
  if (separation <= Math.abs(starRadius - moonRadius)) {
    return moonRadius >= starRadius ? 1 : (moonRadius / starRadius) ** 2;
  }
  const a = Math.acos(
    Math.min(1, Math.max(-1, (separation ** 2 + starRadius ** 2 - moonRadius ** 2) / (2 * separation * starRadius))),
  );
  const b = Math.acos(
    Math.min(1, Math.max(-1, (separation ** 2 + moonRadius ** 2 - starRadius ** 2) / (2 * separation * moonRadius))),
  );
  const lens =
    starRadius ** 2 * a +
    moonRadius ** 2 * b -
    0.5 *
      Math.sqrt(
        Math.max(
          0,
          (-separation + starRadius + moonRadius) *
            (separation + starRadius - moonRadius) *
            (separation - starRadius + moonRadius) *
            (separation + starRadius + moonRadius),
        ),
      );
  return Math.min(1, Math.max(0, lens / (Math.PI * starRadius ** 2)));
}

function eclipseAt(
  star: Star,
  planet: Planet,
  planetMuValue: Mu,
  moon: Moon,
  moonMu: Mu,
  timeDays: number,
): EclipseMaximum | null {
  const sun = planetSunDirection(planet, planetMuValue, timeDays);
  const planetState = elementsToState(planet.elements, planetMuValue, seconds(timeDays * DAY));
  const moonState = elementsToState(moon.elements, moonMu, seconds(timeDays * DAY));
  const moonPosition = toWorld(moonState.position);
  const along = dot(moonPosition, sun);
  if (along <= 0) return null;

  const crossTrack = length(subtract(moonPosition, scale(sun, along)));
  const planetRadius = planet.physical.bulk.radiusEarth * EARTH_RADIUS;
  const moonRadius = moon.physical.bulk.radiusEarth * EARTH_RADIUS;
  // A finder destination needs a real centreline crossing, not a
  // penumbra that merely brushes the limb: this is the ground track
  // we can put the traveler under.
  if (crossTrack >= planetRadius) return null;
  const starAngularRadius = (star.radius * SOLAR_RADIUS) / Math.max(length(planetState.position), 1);
  const stellarDiscAtMoon = along * starAngularRadius;
  // The point on the globe closest to the shadow axis sees this much
  // residual offset between the moon and stellar discs.
  const obscuration = discObscuration(stellarDiscAtMoon, moonRadius, 0);
  if (obscuration < MIN_OBSCURATION) return null;

  const kind: EclipseMaximum['kind'] = moonRadius >= stellarDiscAtMoon ? 'total' : 'annular';
  const perpendicular = subtract(moonPosition, scale(sun, along));
  const towardStar = Math.sqrt(Math.max(0, planetRadius ** 2 - crossTrack ** 2));
  const surface = normalize(add(perpendicular, scale(sun, towardStar)));
  // The terrain is fixed while the celestial frame turns around it.
  // Carry both the track and the star into that planet-fixed frame at
  // the event epoch, exactly as UnifiedViewer does each frame.
  return {
    timeDays,
    obscuration,
    kind,
    surfaceDirection: tuple(turnAroundY(surface, groundSpin(planet, timeDays))),
  };
}

/** Solar elevation where the shadow axis meets the star-facing globe. */
function shadowTrackElevation(
  planet: Planet,
  planetMuValue: Mu,
  moon: Moon,
  moonMu: Mu,
  timeDays: number,
): number | null {
  const sun = planetSunDirection(planet, planetMuValue, timeDays);
  const moonPosition = toWorld(
    elementsToState(moon.elements, moonMu, seconds(timeDays * DAY)).position,
  );
  if (dot(moonPosition, sun) <= 0) return null;
  const crossTrack = length(
    subtract(moonPosition, scale(sun, dot(moonPosition, sun))),
  );
  const planetRadius = planet.physical.bulk.radiusEarth * EARTH_RADIUS;
  if (crossTrack >= planetRadius) return null;
  return Math.acos(Math.min(1, Math.max(0, crossTrack / planetRadius)));
}

/**
 * A central eclipse need not be watched where its track passes closest
 * to the substellar point. Walk backward along the same physical track
 * to a low, readable sun when the conjunction would otherwise put it
 * overhead. This admits clear-sky events without ever manufacturing a
 * shadow or moving the observer outside its centreline.
 */
function viewingEclipseAt(
  star: Star,
  planet: Planet,
  planetMuValue: Mu,
  moon: Moon,
  moonMu: Mu,
  conjunctionDays: number,
): EclipseMaximum | null {
  const peakElevation = shadowTrackElevation(
    planet,
    planetMuValue,
    moon,
    moonMu,
    conjunctionDays,
  );
  if (peakElevation === null || peakElevation < MIN_ARRIVAL_ELEVATION) return null;
  if (peakElevation <= MAX_ARRIVAL_ELEVATION) {
    return eclipseAt(star, planet, planetMuValue, moon, moonMu, conjunctionDays);
  }

  let inside = conjunctionDays;
  let outside: number | null = null;
  let step = CONTACT_STEP_DAYS;
  while (step <= CONTACT_LIMIT_DAYS) {
    const candidate = conjunctionDays - step;
    const elevation = shadowTrackElevation(planet, planetMuValue, moon, moonMu, candidate);
    if (elevation === null || elevation <= TARGET_TRACK_ELEVATION) {
      outside = candidate;
      break;
    }
    inside = candidate;
    step *= 2;
  }
  if (outside === null) return null;
  let outsideTime = outside;
  for (let iteration = 0; iteration < 36; iteration++) {
    const mid = (inside + outsideTime) / 2;
    const elevation = shadowTrackElevation(planet, planetMuValue, moon, moonMu, mid);
    if (elevation !== null && elevation > TARGET_TRACK_ELEVATION) inside = mid;
    else outsideTime = mid;
  }
  return eclipseAt(
    star,
    planet,
    planetMuValue,
    moon,
    moonMu,
    (inside + outsideTime) / 2,
  );
}

/** Angular overlap of the two discs from one fixed place on the ground. */
function contactMargin(
  star: Star,
  planet: Planet,
  planetMuValue: Mu,
  moon: Moon,
  moonMu: Mu,
  surfaceDirection: Vec,
  timeDays: number,
): number {
  const sun = groundSunDirection(planet, planetMuValue, timeDays);
  const observer = scale(surfaceDirection, planet.physical.bulk.radiusEarth * EARTH_RADIUS);
  const toMoon = subtract(groundMoonPosition(planet, moon, moonMu, timeDays), observer);
  const moonDistance = length(toMoon);
  const planetState = elementsToState(planet.elements, planetMuValue, seconds(timeDays * DAY));
  const starDistance = length(planetState.position);
  const starRadius = Math.asin(Math.min(1, (star.radius * SOLAR_RADIUS) / Math.max(starDistance, 1)));
  const moonRadius = Math.asin(
    Math.min(1, (moon.physical.bulk.radiusEarth * EARTH_RADIUS) / Math.max(moonDistance, 1)),
  );
  const separation = Math.acos(Math.min(1, Math.max(-1, dot(normalize(toMoon), sun))));
  return starRadius + moonRadius - separation;
}

function contactEdge(
  star: Star,
  planet: Planet,
  planetMuValue: Mu,
  moon: Moon,
  moonMu: Mu,
  surfaceDirection: Vec,
  maximumDays: number,
  direction: -1 | 1,
): number | null {
  const margin = (timeDays: number): number =>
    contactMargin(star, planet, planetMuValue, moon, moonMu, surfaceDirection, timeDays);
  if (margin(maximumDays) <= 0) return null;
  let inside = maximumDays;
  let step = CONTACT_STEP_DAYS;
  let outside: number | null = null;
  while (step <= CONTACT_LIMIT_DAYS) {
    const candidate = maximumDays + direction * step;
    if (margin(candidate) <= 0) {
      outside = candidate;
      break;
    }
    inside = candidate;
    step *= 2;
  }
  if (outside === null) return null;
  let outsideTime = outside;

  for (let iteration = 0; iteration < 36; iteration++) {
    const mid: number = (inside + outsideTime) / 2;
    if (margin(mid) > 0) inside = mid;
    else outsideTime = mid;
  }
  return (inside + outsideTime) / 2;
}

function timeEclipse(
  star: Star,
  planet: Planet,
  planetMuValue: Mu,
  moon: Moon,
  moonMu: Mu,
  maximum: EclipseMaximum,
): EclipseEvent | null {
  const surface = normalize({
    x: maximum.surfaceDirection[0],
    y: maximum.surfaceDirection[1],
    z: maximum.surfaceDirection[2],
  });
  const startTimeDays = contactEdge(
    star,
    planet,
    planetMuValue,
    moon,
    moonMu,
    surface,
    maximum.timeDays,
    -1,
  );
  const endTimeDays = contactEdge(
    star,
    planet,
    planetMuValue,
    moon,
    moonMu,
    surface,
    maximum.timeDays,
    1,
  );
  if (startTimeDays === null || endTimeDays === null) return null;
  const arrivalTimeDays = startTimeDays - ARRIVAL_LEAD_DAYS;
  const arrivalSun = groundSunDirection(planet, planetMuValue, arrivalTimeDays);
  const arrivalElevation = Math.asin(Math.min(1, Math.max(-1, dot(surface, arrivalSun))));
  // Looking almost straight up is disorienting in ground flight. Pick
  // another real track whose eclipse is comfortably above the horizon
  // but still presented at a readable, angled gaze.
  if (
    arrivalElevation < MIN_ARRIVAL_ELEVATION ||
    arrivalElevation > MAX_ARRIVAL_ELEVATION
  ) {
    return null;
  }
  return {
    ...maximum,
    startTimeDays,
    endTimeDays,
    arrivalTimeDays,
    sunDirection: tuple(arrivalSun),
  };
}

function moonEclipses(
  star: Star,
  planet: Planet,
  planetMuValue: Mu,
  moon: Moon,
  startDays: number,
  windowDays: number,
): EclipseEvent[] {
  const moonMu = muOf(
    G * (planet.physical.bulk.massEarth + moon.physical.bulk.massEarth) * EARTH_MASS,
  );
  const moonPeriodDays = orbitalPeriod(moonMu, moon.elements.semiMajorAxis) / DAY;
  const axes = orbitAxes(moon);
  const nearest = conjunctionNear(planet, planetMuValue, moon, moonMu, axes, startDays);
  const searchStart = startDays - CONTACT_LIMIT_DAYS;
  const searchEnd = startDays + windowDays + CONTACT_LIMIT_DAYS;
  const first = Math.floor((searchStart - nearest) / moonPeriodDays) - 1;
  const last = Math.ceil((searchEnd - nearest) / moonPeriodDays) + 1;
  const events: EclipseEvent[] = [];
  const seen = new Set<number>();
  for (let orbit = first; orbit <= last; orbit++) {
    const timeDays = conjunctionNear(
      planet,
      planetMuValue,
      moon,
      moonMu,
      axes,
      nearest + orbit * moonPeriodDays,
    );
    if (timeDays < searchStart || timeDays > searchEnd) continue;
    const key = Math.round(timeDays * 1e7);
    if (seen.has(key)) continue;
    seen.add(key);
    const maximum = viewingEclipseAt(
      star,
      planet,
      planetMuValue,
      moon,
      moonMu,
      timeDays,
    );
    if (!maximum) continue;
    const event = timeEclipse(star, planet, planetMuValue, moon, moonMu, maximum);
    if (
      event &&
      event.endTimeDays >= startDays &&
      event.startTimeDays <= startDays + windowDays
    ) {
      events.push(event);
    }
  }
  return events;
}

function hosts(system: StarSystem): Host[] {
  return [
    { star: system.star, planets: system.planets, companion: null, index: 0 },
    ...system.companions.map((companion, index) => ({
      star: companion.star,
      planets: companion.planets,
      companion,
      index: index + 1,
    })),
  ];
}

export const ECLIPSE_ATMOSPHERE_VISIBILITY: Record<AtmosphereClass, number> = {
  none: 0,
  'hydrogen-helium': 0.12,
  nitrogen: 0.96,
  'nitrogen-oxygen': 1,
  'thin-co2': 0.72,
  'co2-hothouse': 0.06,
  // Tholin aerosol is optically deep even when the bulk pressure is low.
  'nitrogen-methane': 0.05,
  'rock-vapor': 0.2,
};

function eclipseAtmosphereScore(planet: Planet): number {
  const { atmosphere, appearance } = planet.physical;
  const pressureFit = Math.max(
    0,
    1 - Math.abs(Math.log10(Math.max(atmosphere.surfacePressureBar, 1e-6))) / 1.5,
  );
  const clouds = appearance.clouds;
  const cloudTransmission =
    1 - clouds.coverage + clouds.coverage * Math.exp(-clouds.opticalDepth);
  return (
    ECLIPSE_ATMOSPHERE_VISIBILITY[atmosphere.class] *
    (0.55 + 0.45 * pressureFit) *
    (0.35 + 0.65 * cloudTransmission)
  );
}

function eclipseMerit(
  result: Pick<
    EclipseResult,
    'active' | 'waitDays' | 'distancePc' | 'obscuration' | 'atmosphereScore'
  >,
): number {
  const timing = result.active ? 1 : Math.max(0, 1 - result.waitDays / ECLIPSE_WINDOW_DAYS);
  const proximity = 1 / (1 + result.distancePc / 8);
  return (
    result.atmosphereScore * 0.55 +
    result.obscuration * 0.25 +
    timing * 0.14 +
    proximity * 0.06
  );
}

type RankedEclipse = Pick<
  EclipseResult,
  'active' | 'waitDays' | 'distancePc' | 'obscuration' | 'atmosphereScore' | 'planetName'
>;

function compareEclipses(a: RankedEclipse, b: RankedEclipse): number {
  const merit = eclipseMerit(b) - eclipseMerit(a);
  if (Math.abs(merit) > 1e-8) return merit;
  if (Math.abs(a.waitDays - b.waitDays) > 1e-8) return a.waitDays - b.waitDays;
  if (Math.abs(a.distancePc - b.distancePc) > 1e-6) return a.distancePc - b.distancePc;
  return a.planetName.localeCompare(b.planetName);
}

/** Ranked active or next-day eclipses in one system. */
export function findEclipsesInSystem(
  system: StarSystem,
  startDays: number,
  distancePc = 0,
  windowDays = ECLIPSE_WINDOW_DAYS,
): Array<Omit<EclipseResult, 'positionPc'>> {
  const found: Array<Omit<EclipseResult, 'positionPc'>> = [];
  for (const host of hosts(system)) {
    for (let planetIndex = 0; planetIndex < host.planets.length; planetIndex++) {
      const planet = host.planets[planetIndex];
      // Envelope worlds have no ground for the traveler to stand on.
      if (planet.physical.appearance.banding) continue;
      // An eclipse finder should lead to a sky event. A vacuum—or a
      // trace column too slight to light the horizon and carry the
      // shadow's colour change—does not make a worthwhile destination.
      if (
        planet.physical.atmosphere.class === 'none' ||
        planet.physical.atmosphere.surfacePressureBar < MIN_ECLIPSE_PRESSURE_BAR
      ) {
        continue;
      }
      const planetMuValue = host.companion
        ? companionPlanetMu(host.companion, planet)
        : planetMu(system, planet);
      // The material's analytic shadow seats the first four casters.
      // Search that same visible set: a mathematically valid fifth
      // shadow is not a useful destination if the scene does not draw it.
      for (let moonIndex = 0; moonIndex < Math.min(4, planet.moons.length); moonIndex++) {
        const moon = planet.moons[moonIndex];
        for (const event of moonEclipses(
          host.star,
          planet,
          planetMuValue,
          moon,
          startDays,
          windowDays,
        )) {
          const active = event.startTimeDays <= startDays && event.endTimeDays >= startDays;
          const result: Omit<EclipseResult, 'positionPc'> = {
            seedHex: system.seedHex,
            distancePc,
            hostIndex: host.index,
            planetIndex,
            moonIndex,
            starName: host.star.designation,
            planetName: planet.name,
            moonName: moon.name,
            atmosphereClass: planet.physical.atmosphere.class,
            atmospherePressureBar: planet.physical.atmosphere.surfacePressureBar,
            atmosphereScore: eclipseAtmosphereScore(planet),
            timeDays: event.timeDays,
            startTimeDays: event.startTimeDays,
            endTimeDays: event.endTimeDays,
            arrivalTimeDays: event.arrivalTimeDays,
            active,
            waitDays: active ? 0 : Math.max(0, event.startTimeDays - startDays),
            obscuration: event.obscuration,
            kind: event.kind,
            surfaceDirection: event.surfaceDirection,
            sunDirection: event.sunDirection,
          };
          found.push(result);
        }
      }
    }
  }
  return found.sort(compareEclipses);
}

/** Best single-system result retained for callers that need one destination. */
export function findEclipseInSystem(
  system: StarSystem,
  startDays: number,
  distancePc = 0,
  windowDays = ECLIPSE_WINDOW_DAYS,
): Omit<EclipseResult, 'positionPc'> | null {
  return findEclipsesInSystem(system, startDays, distancePc, windowDays)[0] ?? null;
}

const nextPaint = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });

/**
 * Search outward from the current system. Work is yielded between
 * generated systems so opening the finder never stalls the scene.
 */
export async function findNearbyEclipses(
  current: StarSystem,
  neighbors: readonly Neighbor[],
  startDays: number,
  onProgress?: (progress: EclipseSearchProgress) => void,
  signal?: AbortSignal,
): Promise<EclipseResult[]> {
  const destinations: Array<{ system?: StarSystem; seedHex: string; positionPc: Neighbor['positionPc']; distancePc: number }> = [
    { system: current, seedHex: current.seedHex, positionPc: current.localePc, distancePc: 0 },
  ];
  const seen = new Set([current.seedHex]);
  for (const neighbor of neighbors) {
    if (seen.has(neighbor.seedHex)) continue;
    seen.add(neighbor.seedHex);
    destinations.push(neighbor);
    if (destinations.length >= MAX_ECLIPSE_NEIGHBORS + 1) break;
  }

  const found: EclipseResult[] = [];
  for (let index = 0; index < destinations.length; index++) {
    if (signal?.aborted) return [];
    const destination = destinations[index];
    onProgress?.({ checked: index, total: destinations.length, distancePc: destination.distancePc });
    if (index > 0 && index % 4 === 0) await nextPaint();
    const system =
      destination.system ?? generateSystem(seedFromHex(destination.seedHex), destination.positionPc);
    const events = findEclipsesInSystem(system, startDays, destination.distancePc);
    for (const event of events) {
      found.push({ ...event, positionPc: destination.positionPc });
    }
  }
  onProgress?.({
    checked: destinations.length,
    total: destinations.length,
    distancePc: destinations.at(-1)?.distancePc ?? 0,
  });
  const shortlist: EclipseResult[] = [];
  const worlds = new Set<string>();
  for (const result of found.sort(compareEclipses)) {
    const world = `${result.seedHex}:${result.hostIndex}:${result.planetIndex}`;
    if (worlds.has(world)) continue;
    worlds.add(world);
    shortlist.push(result);
    if (shortlist.length >= ECLIPSE_RESULT_LIMIT) break;
  }
  return shortlist;
}
