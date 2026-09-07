import { findSurfaceEclipses, observerDiscs } from './eclipseGeometry';
import { airmass, horizonAirmass } from '../render/lighting/surfaceLight';
import { aerosolSurfaceExposure, atmosphereColumn } from '../universe/planet/atmosphere';
import { orbitWorldPosition, stellarForcing } from '../universe/planet/illumination';
import { elementsToState } from '../core/math/kepler';
import { orbitalPeriod } from '../core/math/orbit';
import { AU, DAY, EARTH_MASS, EARTH_RADIUS, G, SOLAR_RADIUS } from '../core/physics/constants';
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
export type EclipseEventType = 'moon-shadow' | 'parent-planet' | 'sibling-moon' | 'other-planet';
export type EclipseFilter = EclipseEventType | 'all';
/** Finder results must already be happening or begin inside this window. */
export const ECLIPSE_WINDOW_DAYS = 1;
export const ECLIPSE_RESULT_LIMIT = 24;
/** Systems searched between reports of progress and the shortlist so far. */
export const ECLIPSE_REPORT_EVERY = 64;

interface Vec {
  x: number;
  y: number;
  z: number;
}

/** A real, visitable eclipse in one of the catalog's systems. */
export interface EclipseResult {
  seedHex: string;
  positionPc: Neighbor['positionPc'];
  distancePc: number;
  hostIndex: number;
  planetIndex: number;
  /** Occluding moon, or -1 when the caster is a planet. */
  moonIndex: number;
  /** Destination moon, or -1 for the planet's surface. */
  observerMoonIndex: number;
  eventType: EclipseEventType;
  observerName: string;
  occluderName: string;
  starName: string;
  planetName: string;
  moonName: string;
  atmosphereClass: AtmosphereClass;
  atmospherePressureBar: number;
  /** The sky's part in the event, 0–1: air that scatters enough to make
   *  a sky yet passes enough of the beam to show the eclipsed disc. */
  atmosphereScore: number;
  /** Share of the sun's beam reaching the site through gas and haze at
   *  arrival, and the share scattered into skylight along that path. */
  airTransmission: number;
  airScattering: number;
  /** Weather-mean fraction of the globe under cloud. */
  cloudCover: number;
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
  kind: 'total' | 'annular' | 'partial' | 'transit';
  /** Angular radii of the star's and the blocker's discs from the site at maximum eclipse. */
  starAngularRadius: number;
  casterAngularRadius: number;
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

interface EclipseMaximum {
  timeDays: number;
  obscuration: number;
  kind: EclipseResult['kind'];
  starAngularRadius: number;
  casterAngularRadius: number;
  surfaceDirection: EclipseResult['surfaceDirection'];
}

interface EclipseEvent extends EclipseMaximum {
  startTimeDays: number;
  endTimeDays: number;
  arrivalTimeDays: number;
  sunDirection: EclipseResult['sunDirection'];
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

/** Angular radius of a sphere seen from a site, in the metres of both. */
const apparentRadius = (radius: number, offset: Vec): number =>
  Math.asin(Math.min(1, radius / Math.max(length(offset), 1)));

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
  const starDistance = Math.max(length(planetState.position), 1);
  const stellarDiscAtMoon = (along * star.radius * SOLAR_RADIUS) / starDistance;
  // The point on the globe closest to the shadow axis sees this much
  // residual offset between the moon and stellar discs.
  const obscuration = discObscuration(stellarDiscAtMoon, moonRadius, 0);
  if (obscuration < MIN_OBSCURATION) return null;

  const kind: EclipseMaximum['kind'] = moonRadius >= stellarDiscAtMoon ? 'total' : 'annular';
  const perpendicular = subtract(moonPosition, scale(sun, along));
  const towardStar = Math.sqrt(Math.max(0, planetRadius ** 2 - crossTrack ** 2));
  const surface = normalize(add(perpendicular, scale(sun, towardStar)));
  const site = scale(surface, planetRadius);
  // The terrain is fixed while the celestial frame turns around it.
  // Carry both the track and the star into that planet-fixed frame at
  // the event epoch, exactly as UnifiedViewer does each frame.
  return {
    timeDays,
    obscuration,
    kind,
    starAngularRadius: apparentRadius(star.radius * SOLAR_RADIUS, subtract(scale(sun, starDistance), site)),
    casterAngularRadius: apparentRadius(moonRadius, subtract(moonPosition, site)),
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

export interface EclipseSky {
  transmission: number;
  scattering: number;
  cloudCover: number;
  score: number;
}

/**
 * The sky's part in an eclipse as the site sees it at arrival. The air
 * must scatter enough sunlight to make a sky that can darken, yet pass
 * enough of the beam that the eclipsed disc still shows. Both follow
 * the green-band column the renderer draws with, along the slant to
 * the sun, and their product peaks where half the beam gets through.
 * An airless world has nothing to take part, and a cloud deck dims
 * what does, softened because its cover is a weather mean rather than
 * a forecast for the site.
 */
export function eclipseSky(body: Pick<Planet, 'physical'>, sunElevationSin: number): EclipseSky {
  const { atmosphere, bulk, climate, appearance } = body.physical;
  if (atmosphere.class === 'none') return { transmission: 1, scattering: 0, cloudCover: 0, score: 0 };
  const column = atmosphereColumn(
    atmosphere,
    bulk,
    aerosolSurfaceExposure(atmosphere, climate.iceCapLatitudeRad),
  );
  const radiusKm = (bulk.radiusEarth * EARTH_RADIUS) / 1000;
  const mu = Math.max(0, sunElevationSin);
  const gasPath = airmass(mu, horizonAirmass(radiusKm, atmosphere.scaleHeightKm));
  const hazePath = airmass(
    mu,
    horizonAirmass(radiusKm, atmosphere.scaleHeightKm * column.aerosolScaleHeightRatio),
  );
  const transmission = Math.exp(
    -(column.rayleigh[1] * gasPath + column.aerosolExtinction[1] * hazePath),
  );
  const scattering = 1 - Math.exp(-(column.rayleigh[1] * gasPath + column.aerosol[1] * hazePath));
  const clouds = appearance.clouds;
  const cloudTransmission =
    1 - clouds.coverage + clouds.coverage * Math.exp(-clouds.opticalDepth);
  return {
    transmission,
    scattering,
    cloudCover: clouds.coverage,
    score: 4 * transmission * scattering * (0.35 + 0.65 * cloudTransmission),
  };
}

/** A result's sky as its observing body and its arrival sun give it. */
function skyFields(
  body: Planet | Moon,
  event: Pick<EclipseEvent, 'surfaceDirection' | 'sunDirection'>,
): Pick<
  EclipseResult,
  | 'atmosphereClass'
  | 'atmospherePressureBar'
  | 'atmosphereScore'
  | 'airTransmission'
  | 'airScattering'
  | 'cloudCover'
> {
  const sky = eclipseSky(
    body,
    event.surfaceDirection.reduce((sum, c, i) => sum + c * event.sunDirection[i], 0),
  );
  return {
    atmosphereClass: body.physical.atmosphere.class,
    atmospherePressureBar: body.physical.atmosphere.surfacePressureBar,
    atmosphereScore: sky.score,
    airTransmission: sky.transmission,
    airScattering: sky.scattering,
    cloudCover: sky.cloudCover,
  };
}

/** The Sun's angular radius from Earth: an eclipse this wide scores half on size. */
const REFERENCE_ECLIPSE_RADIUS = SOLAR_RADIUS / AU;

/** Angular radius of the disc the eclipse takes out of the sky: the
 *  whole star when it is covered, the blocker inside an annulus, and
 *  the equal-area disc of a partial bite. */
export function eclipsedAngularRadius(
  result: Pick<EclipseResult, 'starAngularRadius' | 'obscuration'>,
): number {
  return result.starAngularRadius * Math.sqrt(result.obscuration);
}

export function eclipseMerit(
  result: Pick<
    EclipseResult,
    'active' | 'waitDays' | 'distancePc' | 'obscuration' | 'atmosphereScore' | 'starAngularRadius'
  >,
): number {
  const timing = result.active ? 1 : Math.max(0, 1 - result.waitDays / ECLIPSE_WINDOW_DAYS);
  const proximity = 1 / (1 + result.distancePc / 8);
  const eclipsed = eclipsedAngularRadius(result);
  const size = eclipsed / (eclipsed + REFERENCE_ECLIPSE_RADIUS);
  return (
    result.atmosphereScore * 0.4 +
    result.obscuration * 0.2 +
    size * 0.2 +
    timing * 0.14 +
    proximity * 0.06
  );
}

type RankedEclipse = Pick<
  EclipseResult,
  | 'active'
  | 'waitDays'
  | 'distancePc'
  | 'obscuration'
  | 'atmosphereScore'
  | 'starAngularRadius'
  | 'planetName'
>;

function compareEclipses(a: RankedEclipse, b: RankedEclipse): number {
  const merit = eclipseMerit(b) - eclipseMerit(a);
  if (Math.abs(merit) > 1e-8) return merit;
  if (Math.abs(a.waitDays - b.waitDays) > 1e-8) return a.waitDays - b.waitDays;
  if (Math.abs(a.distancePc - b.distancePc) > 1e-6) return a.distancePc - b.distancePc;
  return a.planetName.localeCompare(b.planetName);
}

const worldOf = (
  result: Pick<EclipseResult, 'seedHex' | 'hostIndex' | 'planetIndex' | 'observerMoonIndex'>,
): string => `${result.seedHex}:${result.hostIndex}:${result.planetIndex}:${result.observerMoonIndex}`;

/** The shortlist with ranked events folded in: each world keeps its
 *  best event, and the list keeps its best worlds. A world is searched
 *  once, so one that falls off the end never comes back. */
export function shortlistEclipses(
  shortlist: readonly EclipseResult[],
  events: readonly EclipseResult[],
): EclipseResult[] {
  const worlds = new Set(shortlist.map(worldOf));
  const merged = [...shortlist];
  for (const event of events) {
    const world = worldOf(event);
    if (worlds.has(world)) continue;
    worlds.add(world);
    merged.push(event);
  }
  return merged.sort(compareEclipses).slice(0, ECLIPSE_RESULT_LIMIT);
}

/** Additional caster/observer pairs use the same placement frames as UnifiedViewer:
 * heliocentric planets lean with the body; local satellites spin in the
 * equatorial group. Stellar reflex is included for circumbinary systems. */
function additionalEclipses(
  system: StarSystem,
  host: Host,
  planetIndex: number,
  startDays: number,
  windowDays: number,
  distancePc: number,
  filter: EclipseFilter,
): Array<Omit<EclipseResult, 'positionPc'>> {
  const parent = host.planets[planetIndex];
  const pmu = (planet: Planet): Mu =>
    host.companion ? companionPlanetMu(host.companion, planet) : planetMu(system, planet);
  const mmu = (moon: Moon): Mu =>
    muOf(G * (parent.physical.bulk.massEarth + moon.physical.bulk.massEarth) * EARTH_MASS);
  const position = (body: Planet | Moon, mu: Mu, t: number): Vec =>
    toWorld(elementsToState(body.elements, mu, seconds(t * DAY)).position);
  const period = (body: Planet | Moon, mu: Mu): number =>
    ((orbitalPeriod(mu, body.elements.semiMajorAxis) / DAY) *
      Math.pow(1 - body.elements.eccentricity, 1.5)) /
    Math.sqrt(1 + body.elements.eccentricity);
  const forcing = stellarForcing(system.star, system.companions, system.configuration, host.index);
  const found: Array<Omit<EclipseResult, 'positionPc'>> = [];
  for (let observerMoonIndex = -1; observerMoonIndex < parent.moons.length; observerMoonIndex++) {
    const observer = observerMoonIndex < 0 ? parent : parent.moons[observerMoonIndex];
    if (observer.physical.appearance.banding) continue;
    const pairs: { body: Planet | Moon; type: EclipseEventType; moonIndex: number }[] = [];
    if (observerMoonIndex >= 0) {
      pairs.push({ body: parent, type: 'parent-planet', moonIndex: -1 });
      parent.moons.forEach((moon, i) => {
        if (i !== observerMoonIndex) pairs.push({ body: moon, type: 'sibling-moon', moonIndex: i });
      });
    }
    if (observerMoonIndex < 0)
      parent.moons.forEach((moon, i) =>
        pairs.push({ body: moon, type: 'moon-shadow', moonIndex: i }),
      );
    host.planets.forEach((planet) => {
      if (planet !== parent) pairs.push({ body: planet, type: 'other-planet', moonIndex: -1 });
    });
    for (const pair of pairs) {
      if (pair.type === 'moon-shadow' || (filter !== 'all' && filter !== pair.type)) continue;
      const peri = (body: Planet | Moon) =>
        body.elements.semiMajorAxis * (1 - body.elements.eccentricity);
      const apo = (body: Planet | Moon) =>
        body.elements.semiMajorAxis * (1 + body.elements.eccentricity);
      const radialGap = (a: Planet | Moon, b: Planet | Moon) =>
        Math.max(0, peri(a) - apo(b), peri(b) - apo(a));
      const moonReach = observerMoonIndex >= 0 ? apo(observer) : 0;
      const separationBound =
        pair.type === 'other-planet'
          ? radialGap(parent, pair.body) - moonReach
          : pair.type === 'sibling-moon'
            ? radialGap(observer, pair.body)
            : peri(observer);
      const starReach = [...forcing.origin, ...forcing.sources[host.index].path].reduce(
        (sum, term) =>
          sum +
          Math.abs(term.scale ?? 1) *
            term.elements.semiMajorAxis *
            (1 + term.elements.eccentricity),
        0,
      );
      const observerRadius = observer.physical.bulk.radiusEarth * EARTH_RADIUS;
      const maxStarDistance = apo(parent) + moonReach + starReach + observerRadius;
      const maxCasterAngle = Math.asin(
        Math.min(
          1,
          (pair.body.physical.bulk.radiusEarth * EARTH_RADIUS) /
            Math.max(1, separationBound - observerRadius),
        ),
      );
      const minStarAngle = Math.asin(
        Math.min(1, (host.star.radius * SOLAR_RADIUS) / maxStarDistance),
      );
      const threshold = pair.type === 'other-planet' ? 0.001 : MIN_OBSCURATION;
      // Safe radial bound: most interplanetary crossings are too small
      // to meet the visibility threshold, regardless of orbital phase.
      if ((maxCasterAngle / minStarAngle) ** 2 < threshold) continue;
      const fastest = Math.min(
        period(parent, pmu(parent)),
        observerMoonIndex >= 0 ? period(observer, mmu(observer as Moon)) : Infinity,
        pair.type === 'sibling-moon'
          ? period(pair.body, mmu(pair.body as Moon))
          : pair.type === 'other-planet'
            ? period(pair.body, pmu(pair.body as Planet))
            : Infinity,
      );
      const geometryFor = (candidate: typeof pair, t: number): { star: Vec; caster: Vec } => {
        const p = position(parent, pmu(parent), t);
        const moon =
          observerMoonIndex >= 0
            ? position(observer, mmu(observer as Moon), t)
            : { x: 0, y: 0, z: 0 };
        const starOffset = subtract(
          orbitWorldPosition(forcing.sources[host.index].path, t * DAY),
          orbitWorldPosition(forcing.origin, t * DAY),
        );
        const rotation = observer.physical.rotation;
        const spin = (-TAU * 24 * t) / rotation.periodHours;
        const star = turnAroundY(
          lean(subtract(subtract(starOffset, p), moon), rotation.obliquityRad),
          spin,
        );
        const caster =
          candidate.type === 'other-planet'
            ? lean(
                subtract(
                  subtract(position(candidate.body, pmu(candidate.body as Planet), t), p),
                  moon,
                ),
                rotation.obliquityRad,
              )
            : candidate.type === 'parent-planet'
              ? scale(moon, -1)
              : subtract(position(candidate.body, mmu(candidate.body as Moon), t), moon);
        return { star, caster: turnAroundY(caster, spin) };
      };
      const geometry = (t: number) => geometryFor(pair, t);
      for (const event of findSurfaceEclipses({
        geometry,
        bodyRadius: observer.physical.bulk.radiusEarth * EARTH_RADIUS,
        casterRadius: pair.body.physical.bulk.radiusEarth * EARTH_RADIUS,
        starRadius: host.star.radius * SOLAR_RADIUS,
        startDays,
        windowDays,
        shortestPeriodDays: fastest,
        minimumObscuration: threshold,
        planetaryTransit: pair.type === 'other-planet',
      })) {
        const surface = {
          x: event.surfaceDirection[0],
          y: event.surfaceDirection[1],
          z: event.surfaceDirection[2],
        };
        // Do not advertise a sibling/planet transit inside the much
        // larger parent's eclipse (or any other simultaneous cover).
        if (
          pairs.some(
            (other) =>
              other !== pair &&
              observerDiscs(
                geometryFor(other, event.timeDays),
                surface,
                observer.physical.bulk.radiusEarth * EARTH_RADIUS,
                host.star.radius * SOLAR_RADIUS,
                other.body.physical.bulk.radiusEarth * EARTH_RADIUS,
              ).obscuration > 0.01,
          )
        )
          continue;
        const active = event.startTimeDays <= startDays && event.endTimeDays >= startDays;
        found.push({
          ...event,
          seedHex: system.seedHex,
          distancePc,
          hostIndex: host.index,
          planetIndex,
          observerMoonIndex,
          eventType: pair.type,
          moonIndex: pair.moonIndex,
          observerName: observer.name,
          occluderName: pair.body.name,
          planetName: parent.name,
          moonName: pair.moonIndex >= 0 ? pair.body.name : '',
          starName: host.star.designation,
          ...skyFields(observer, event),
          active,
          waitDays: active ? 0 : Math.max(0, event.startTimeDays - startDays),
        });
      }
    }
  }
  return found;
}

/** Ranked active or next-day eclipses in one system. */
export function findEclipsesInSystem(
  system: StarSystem,
  startDays: number,
  distancePc = 0,
  windowDays = ECLIPSE_WINDOW_DAYS,
  filter: EclipseFilter = 'all',
): Array<Omit<EclipseResult, 'positionPc'>> {
  const found: Array<Omit<EclipseResult, 'positionPc'>> = [];
  for (const host of hosts(system)) {
    for (let planetIndex = 0; planetIndex < host.planets.length; planetIndex++) {
      const planet = host.planets[planetIndex];

      const planetMuValue = host.companion
        ? companionPlanetMu(host.companion, planet)
        : planetMu(system, planet);
      // The renderer selects the strongest aligned casters, not the first moons.
      for (let moonIndex = 0; !planet.physical.appearance.banding && (filter === 'all' || filter === 'moon-shadow') && moonIndex < planet.moons.length; moonIndex++) {
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
            observerMoonIndex: -1,
            eventType: 'moon-shadow',
            observerName: planet.name,
            occluderName: moon.name,
            starName: host.star.designation,
            planetName: planet.name,
            moonName: moon.name,
            ...skyFields(planet, event),
            timeDays: event.timeDays,
            startTimeDays: event.startTimeDays,
            endTimeDays: event.endTimeDays,
            arrivalTimeDays: event.arrivalTimeDays,
            active,
            waitDays: active ? 0 : Math.max(0, event.startTimeDays - startDays),
            obscuration: event.obscuration,
            kind: event.kind,
            starAngularRadius: event.starAngularRadius,
            casterAngularRadius: event.casterAngularRadius,
            surfaceDirection: event.surfaceDirection,
            sunDirection: event.sunDirection,
          };
          found.push(result);
        }
      }
      found.push(...additionalEclipses(system, host, planetIndex, startDays, windowDays, distancePc, filter));
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
  typeof document === 'undefined' ? Promise.resolve() : new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });

/**
 * Search outward through the whole neighbourhood, nearest first. The
 * shortlist so far is reported every few systems, so a rare event type
 * can be waited for and a common one stopped early. Work is yielded
 * between generated systems so opening the finder never stalls the scene.
 */
export async function findNearbyEclipses(
  current: StarSystem,
  neighbors: readonly Neighbor[],
  startDays: number,
  onProgress?: (progress: EclipseSearchProgress) => void,
  signal?: AbortSignal,
  filter: EclipseFilter = 'all',
  onResults?: (results: EclipseResult[]) => void,
): Promise<EclipseResult[]> {
  const destinations: Array<{ system?: StarSystem; seedHex: string; positionPc: Neighbor['positionPc']; distancePc: number }> = [
    { system: current, seedHex: current.seedHex, positionPc: current.localePc, distancePc: 0 },
  ];
  const seen = new Set([current.seedHex]);
  for (const neighbor of neighbors) {
    if (seen.has(neighbor.seedHex)) continue;
    seen.add(neighbor.seedHex);
    destinations.push(neighbor);
  }

  let shortlist: EclipseResult[] = [];
  let reported = shortlist;
  const progress = (checked: number): void =>
    onProgress?.({
      checked,
      total: destinations.length,
      distancePc: destinations[Math.min(checked, destinations.length - 1)].distancePc,
    });
  for (let index = 0; index < destinations.length; index++) {
    if (signal?.aborted) return [];
    if (index % ECLIPSE_REPORT_EVERY === 0) {
      progress(index);
      if (shortlist !== reported) {
        reported = shortlist;
        onResults?.(shortlist);
      }
    }
    if (index > 0) await nextPaint();
    if (signal?.aborted) return [];
    const destination = destinations[index];
    const system =
      destination.system ?? generateSystem(seedFromHex(destination.seedHex), destination.positionPc);
    const events = findEclipsesInSystem(system, startDays, destination.distancePc, ECLIPSE_WINDOW_DAYS, filter);
    if (events.length > 0) {
      shortlist = shortlistEclipses(
        shortlist,
        events.map((event) => ({ ...event, positionPc: destination.positionPc })),
      );
    }
  }
  progress(destinations.length);
  return shortlist;
}
