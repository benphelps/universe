import { describe, expect, it } from 'vitest';
import { generateSystem } from '../universe/system/generate';
import { ECLIPSE_ATMOSPHERE_VISIBILITY, findEclipseInSystem, findEclipsesInSystem } from './eclipseFinder';

describe('eclipse finder', () => {
  it('strongly prefers clear nitrogen skies over optically deep haze', () => {
    expect(ECLIPSE_ATMOSPHERE_VISIBILITY.nitrogen).toBeGreaterThan(0.9);
    expect(ECLIPSE_ATMOSPHERE_VISIBILITY['nitrogen-oxygen']).toBeGreaterThan(0.9);
    expect(ECLIPSE_ATMOSPHERE_VISIBILITY['nitrogen-methane']).toBeLessThan(
      ECLIPSE_ATMOSPHERE_VISIBILITY.nitrogen * 0.1,
    );
    expect(ECLIPSE_ATMOSPHERE_VISIBILITY['co2-hothouse']).toBeLessThan(
      ECLIPSE_ATMOSPHERE_VISIBILITY['thin-co2'] * 0.1,
    );
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
      const elevation = Math.asin(
        event.surfaceDirection.reduce(
          (sum, component, index) => sum + component * event.sunDirection[index],
          0,
        ),
      );
      expect(elevation).toBeGreaterThanOrEqual((5 * Math.PI) / 180);
      if (event.eventType === 'moon-shadow') expect(elevation).toBeLessThanOrEqual((25 * Math.PI) / 180);
    }
  }, 30000);

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
  expect(events[0].atmosphereScore).toBe(1);
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
