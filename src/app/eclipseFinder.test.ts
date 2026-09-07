import { describe, expect, it } from 'vitest';
import { AU, EARTH_RADIUS, SOLAR_RADIUS } from '../core/physics/constants';
import type { AtmosphereClass } from '../universe/planet/types';
import { generateSystem } from '../universe/system/generate';
import {
  ECLIPSE_REPORT_EVERY,
  ECLIPSE_RESULT_LIMIT,
  eclipseMerit,
  eclipseSky,
  eclipsedAngularRadius,
  findEclipseInSystem,
  findEclipsesInSystem,
  findNearbyEclipses,
  shortlistEclipses,
} from './eclipseFinder';

/** An Earth-sized world under a chosen sky, seen toward a sun at the given elevation. */
function skyOf(
  klass: AtmosphereClass,
  pressureBar: number,
  elevationDeg = 20,
  gravityMs2 = 9.8,
  clouds = { coverage: 0, opticalDepth: 0 },
) {
  const planet = generateSystem(1185n).planets[0];
  const physical = {
    ...planet.physical,
    bulk: { ...planet.physical.bulk, radiusEarth: 1, gravityMs2 },
    atmosphere: {
      class: klass,
      surfacePressureBar: pressureBar,
      scaleHeightKm: 8,
      opticalDepth: 0,
      scatteringColor: [0, 0, 0] as [number, number, number],
    },
    appearance: { ...planet.physical.appearance, clouds: { ...planet.physical.appearance.clouds, ...clouds } },
    climate: { ...planet.physical.climate, iceCapLatitudeRad: Math.PI / 2 },
  };
  return eclipseSky({ physical }, Math.sin((elevationDeg * Math.PI) / 180));
}

describe('eclipse finder', () => {
  it('wants a sky that takes part yet still shows the sun', () => {
    const earth = skyOf('nitrogen-oxygen', 1);
    expect(earth.score).toBeGreaterThan(0.8);
    expect(earth.transmission).toBeGreaterThan(0.5);
    expect(earth.scattering).toBeGreaterThan(0.2);
    // Nothing takes part on an airless world; a hothouse or a tholin haze hides the sun.
    expect(skyOf('none', 0)).toEqual({ transmission: 1, scattering: 0, cloudCover: 0, score: 0 });
    expect(skyOf('co2-hothouse', 92, 20, 8.87).score).toBeLessThan(0.01);
    expect(skyOf('nitrogen-methane', 1.5, 20, 1.35).score).toBeLessThan(0.05);
    // Thin air barely makes a sky; dusty thin CO₂ makes one but dims the sun.
    const thin = skyOf('nitrogen', 0.05);
    expect(thin.transmission).toBeGreaterThan(0.9);
    expect(thin.score).toBeLessThan(0.3);
    const mars = skyOf('thin-co2', 0.006, 20, 3.7);
    expect(mars.score).toBeGreaterThan(0.5);
    expect(mars.transmission).toBeLessThan(earth.transmission);
    // A low sun puts more air on the slant, so the same world scores higher at 20° than overhead.
    expect(earth.score).toBeGreaterThan(skyOf('nitrogen-oxygen', 1, 90).score);
    // A full cloud deck keeps only the softened share.
    const overcast = skyOf('nitrogen-oxygen', 1, 20, 9.8, { coverage: 1, opticalDepth: 10 });
    expect(overcast.cloudCover).toBe(1);
    expect(overcast.score).toBeCloseTo(0.35 * earth.score, 3);
  });

  it('finds active or next-day events with visible contact windows', () => {
    // Keep the population sweep, plus known surviving primary and
    // companion-host events. A seed sample's eclipse frequency is not
    // a finder invariant when formation/stability physics changes.
    const systems = [...Array.from({ length: 1024 }, (_, i) => i + 1), 1185, 2997, 4263]
      .map(seed => generateSystem(BigInt(seed)));
    const found = systems
      .map((system) => findEclipseInSystem(system, 0))
      .filter((event) => event !== null);

    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.some(event => event.hostIndex === 0)).toBe(true);
    expect(found.some(event => event.hostIndex > 0)).toBe(true);
    for (const event of found) {
      expect(event.endTimeDays).toBeGreaterThanOrEqual(0);
      expect(event.startTimeDays).toBeLessThan(event.timeDays);
      expect(event.endTimeDays).toBeGreaterThan(event.timeDays);
      expect(event.arrivalTimeDays).toBeLessThan(event.startTimeDays);
      expect(event.waitDays).toBeGreaterThanOrEqual(0);
      expect(event.waitDays).toBeLessThanOrEqual(1);
      expect(event.obscuration).toBeGreaterThanOrEqual(event.eventType === 'other-planet' ? .001 : .5);
      expect(event.planetName).toBeTruthy();
      expect(event.observerName).toBeTruthy();
      expect(event.occluderName).toBeTruthy();
      expect(event.observerMoonIndex).toBeGreaterThanOrEqual(-1);
      expect(Math.hypot(...event.surfaceDirection)).toBeCloseTo(1, 8);
      expect(Math.hypot(...event.sunDirection)).toBeCloseTo(1, 8);
      expect(event.starAngularRadius).toBeGreaterThan(0);
      expect(event.starAngularRadius).toBeLessThan(Math.PI / 2);
      expect(event.casterAngularRadius).toBeGreaterThan(0);
      expect(event.casterAngularRadius).toBeLessThan(Math.PI / 2);
      if (event.kind === 'total') {
        expect(event.casterAngularRadius).toBeGreaterThanOrEqual(event.starAngularRadius * 0.999);
      }
      const elevation = Math.asin(
        event.surfaceDirection.reduce(
          (sum, component, index) => sum + component * event.sunDirection[index],
          0,
        ),
      );
      expect(elevation).toBeGreaterThanOrEqual((5 * Math.PI) / 180);
      if (event.eventType === 'moon-shadow') expect(elevation).toBeLessThanOrEqual((25 * Math.PI) / 180);
    }
  }, 120000);

  it('recognizes an eclipse already active at the current epoch', () => {
    const system = generateSystem(1185n);
    const upcoming = findEclipseInSystem(system, 0);
    expect(upcoming).not.toBeNull();
    const midpoint = (upcoming!.startTimeDays + upcoming!.endTimeDays) / 2;
    const active = findEclipseInSystem(system, midpoint);
    expect(active?.active).toBe(true);
    expect(active?.waitDays).toBe(0);
  });

  it('returns the same event for the same system and epoch', () => {
    const system = generateSystem(990n);
    expect(findEclipseInSystem(system, 123)).not.toBeNull();
    expect(findEclipseInSystem(system, 123)).toEqual(findEclipseInSystem(system, 123));
  });

  it('ranks a wider eclipse above the same eclipse on a smaller star', () => {
    const base = { active: true, waitDays: 0, distancePc: 0, obscuration: 1, atmosphereScore: 1 };
    const earthSun = SOLAR_RADIUS / AU;
    const wide = eclipseMerit({ ...base, starAngularRadius: 4 * earthSun });
    const earthLike = eclipseMerit({ ...base, starAngularRadius: earthSun });
    const narrow = eclipseMerit({ ...base, starAngularRadius: earthSun / 4 });
    expect(wide).toBeGreaterThan(earthLike);
    expect(earthLike).toBeGreaterThan(narrow);
    // Size is one factor among the others: a clear sky still beats haze.
    expect(narrow).toBeGreaterThan(
      eclipseMerit({ ...base, atmosphereScore: 0.05, starAngularRadius: 40 * earthSun }),
    );
    // The eclipsed disc is the whole star when covered, the blocker within an annulus.
    expect(eclipsedAngularRadius({ starAngularRadius: 0.01, obscuration: 1 })).toBeCloseTo(0.01, 12);
    expect(eclipsedAngularRadius({ starAngularRadius: 0.01, obscuration: 0.25 })).toBeCloseTo(0.005, 12);
  });

  it('walks the whole neighbourhood, reporting the ranked shortlist as it goes', async () => {
    // Seeds whose systems hold an event at epoch 0, enough of them to
    // cross a report boundary.
    const seeds = [
      1, 5, 11, 16, 18, 20, 24, 25, 26, 29, 30, 35, 37, 38, 42, 44, 46, 48, 51, 56, 57, 60, 66, 67,
      69, 73, 74, 76, 77, 79, 81, 82, 84, 85, 86, 87, 89, 95, 97, 98, 99, 100, 104, 112, 122, 124,
      127, 128, 130, 131, 138, 140, 145, 154, 155, 172, 173, 177, 178, 185, 186, 189, 191, 198, 199,
      200, 204, 205, 206, 217,
    ];
    expect(seeds.length).toBeGreaterThan(ECLIPSE_REPORT_EVERY);
    const systems = seeds.map((seed) => generateSystem(BigInt(seed)));
    const neighbors = systems.slice(1).map((system, index) => ({
      seedHex: system.seedHex,
      distancePc: index + 1,
      luminosity: 1,
      tEff: 5000,
      positionPc: system.localePc,
    }));
    const progress: number[] = [];
    const partials: ReturnType<typeof shortlistEclipses>[] = [];
    const results = await findNearbyEclipses(
      systems[0],
      neighbors,
      0,
      (report) => progress.push(report.checked),
      undefined,
      'all',
      (partial) => partials.push(partial),
    );
    expect(progress).toEqual([0, ECLIPSE_REPORT_EVERY, systems.length]);
    const ranked = systems.map((system, index) =>
      findEclipsesInSystem(system, 0, index).map((event) => ({ ...event, positionPc: system.localePc })),
    );
    // One report on the way, holding exactly the search up to that point.
    expect(partials).toEqual([shortlistEclipses([], ranked.slice(0, ECLIPSE_REPORT_EVERY).flat())]);
    expect(results).toEqual(shortlistEclipses([], ranked.flat()));
    expect(results.length).toBe(ECLIPSE_RESULT_LIMIT);
    const worlds = results.map(
      (r) => `${r.seedHex}:${r.hostIndex}:${r.planetIndex}:${r.observerMoonIndex}`,
    );
    expect(new Set(worlds).size).toBe(results.length);
    for (let i = 1; i < results.length; i++) {
      expect(eclipseMerit(results[i - 1])).toBeGreaterThanOrEqual(eclipseMerit(results[i]) - 1e-12);
    }
  }, 60000);
});

// Controlled coplanar orbits isolate event types from seed demographics.
function fixture() {
  const system = structuredClone(generateSystem(1185n));
  const parent = system.planets.find((p) => p.moons.length > 0)!;
  system.planets = [parent];
  system.companions = [];
  system.configuration = 'single';
  parent.elements = {
    ...parent.elements,
    semiMajorAxis: 1.496e11 as typeof parent.elements.semiMajorAxis,
    eccentricity: 0,
    inclination: 0,
    longitudeOfAscendingNode: 0,
    argumentOfPeriapsis: 0,
    meanAnomalyAtEpoch: Math.PI,
    epoch: 0 as typeof parent.elements.epoch,
  };
  parent.physical.rotation.obliquityRad = 0;
  parent.physical.appearance.banding = null;
  parent.physical.atmosphere.class = 'none';
  parent.physical.atmosphere.surfacePressureBar = 0;
  parent.moons = [parent.moons[0]];
  const moon = parent.moons[0];
  moon.elements = {
    ...moon.elements,
    eccentricity: 0,
    inclination: 0,
    longitudeOfAscendingNode: 0,
    argumentOfPeriapsis: 0,
    meanAnomalyAtEpoch: Math.PI,
    epoch: 0 as typeof moon.elements.epoch,
  };
  moon.physical.rotation.obliquityRad = 0;
  moon.physical.appearance.banding = null;
  moon.physical.atmosphere.class = 'none';
  moon.physical.atmosphere.surfacePressureBar = 0;
  return system;
}

it('finds a parent eclipsing the star from an airless moon, with explicit destination identity', () => {
  const system = fixture();
  const events = findEclipsesInSystem(system, 0, 0, 1, 'parent-planet');
  expect(events.length).toBeGreaterThan(0);
  expect(
    events.every(
      (e) => e.eventType === 'parent-planet' && e.observerMoonIndex === 0 && e.moonIndex === -1,
    ),
  ).toBe(true);
  expect(events[0].observerName).toBe(system.planets[0].moons[0].name);
  expect(events[0].occluderName).toBe(system.planets[0].name);
  expect(events[0].atmosphereScore).toBe(0);
  expect(events[0].airTransmission).toBe(1);
  expect(events[0].cloudCover).toBe(0);
  // Both discs as the site sees them: the star a circular AU away, the
  // parent at the moon's orbital radius, and wider than the star.
  const [parent] = system.planets;
  const moon = parent.moons[0];
  const starSize = (system.star.radius * SOLAR_RADIUS) / 1.496e11;
  const parentSize = Math.asin((parent.physical.bulk.radiusEarth * EARTH_RADIUS) / moon.elements.semiMajorAxis);
  expect(Math.abs(events[0].starAngularRadius / starSize - 1)).toBeLessThan(0.02);
  expect(Math.abs(events[0].casterAngularRadius / parentSize - 1)).toBeLessThan(0.1);
  expect(events[0].casterAngularRadius).toBeGreaterThan(events[0].starAngularRadius);
});

it('includes real small planet transits and honors the event filter', () => {
  const system = fixture(),
    parent = system.planets[0];
  parent.moons = [];
  parent.physical.rotation.periodHours = 1000;
  parent.physical.bulk.radiusEarth = 1;
  system.star.radius = 1;
  const inner = structuredClone(parent);
  inner.name = 'Inner transit planet';
  inner.elements.semiMajorAxis = 7.48e10 as typeof inner.elements.semiMajorAxis;
  inner.physical.bulk.radiusEarth = 5;
  system.planets.push(inner);
  const events = findEclipsesInSystem(system, 0, 0, 1, 'other-planet');
  expect(
    events.some(
      (e) => e.kind === 'transit' && e.planetIndex === 0 && e.occluderName === inner.name,
    ),
  ).toBe(true);
  expect(events.every((e) => e.eventType === 'other-planet')).toBe(true);
  expect(findEclipsesInSystem(system, 0, 0, 1, 'sibling-moon')).toEqual([]);
});

it('finds mutual moon eclipses on the star-facing side of their parent', () => {
  const system = fixture(),
    parent = system.planets[0],
    moon = parent.moons[0];
  system.star.radius = 0.1;
  moon.elements.meanAnomalyAtEpoch = 0;
  moon.elements.semiMajorAxis = (parent.physical.bulk.radiusEarth *
    6.371e6 *
    10) as typeof moon.elements.semiMajorAxis;
  const sibling = structuredClone(moon);
  sibling.name = 'Outer sibling';
  sibling.elements.semiMajorAxis = (moon.elements.semiMajorAxis *
    1.5) as typeof sibling.elements.semiMajorAxis;
  parent.moons.push(sibling);
  const events = findEclipsesInSystem(system, 0, 0, 1, 'sibling-moon');
  expect(events.some((e) => e.observerMoonIndex === 0 && e.moonIndex === 1)).toBe(true);
  expect(events.every((e) => e.eventType === 'sibling-moon')).toBe(true);
});
