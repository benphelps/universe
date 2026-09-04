import { describe, expect, it } from 'vitest';
import { generateSystem } from '../universe/system/generate';
import { ECLIPSE_ATMOSPHERE_VISIBILITY, findEclipseInSystem } from './eclipseFinder';

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

  it('finds only active or next-day eclipses with an angled, start-to-finish view', () => {
    const systems = Array.from({ length: 1024 }, (_, index) => generateSystem(BigInt(index + 1)));
    const found = systems
      .map((system) => findEclipseInSystem(system, 0))
      .filter((event) => event !== null);

    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const event of found) {
      expect(event.timeDays).toBeGreaterThanOrEqual(0);
      expect(event.startTimeDays).toBeLessThan(event.timeDays);
      expect(event.endTimeDays).toBeGreaterThan(event.timeDays);
      expect(event.arrivalTimeDays).toBeLessThan(event.startTimeDays);
      expect(event.waitDays).toBeGreaterThanOrEqual(0);
      expect(event.waitDays).toBeLessThanOrEqual(1);
      expect(event.obscuration).toBeGreaterThanOrEqual(0.5);
      expect(event.planetName).toBeTruthy();
      expect(event.moonName).toBeTruthy();
      expect(event.atmosphereClass).not.toBe('none');
      expect(event.atmospherePressureBar).toBeGreaterThanOrEqual(0.05);
      expect(Math.hypot(...event.surfaceDirection)).toBeCloseTo(1, 8);
      expect(Math.hypot(...event.sunDirection)).toBeCloseTo(1, 8);
      const elevation = Math.asin(
        event.surfaceDirection.reduce(
          (sum, component, index) => sum + component * event.sunDirection[index],
          0,
        ),
      );
      expect(elevation).toBeGreaterThanOrEqual((10 * Math.PI) / 180);
      expect(elevation).toBeLessThanOrEqual((25 * Math.PI) / 180);
    }
  });

  it('recognizes an eclipse already active at the current epoch', () => {
    const systems = Array.from({ length: 1024 }, (_, index) => generateSystem(BigInt(index + 1)));
    const upcoming = systems
      .map((system) => ({ system, event: findEclipseInSystem(system, 0) }))
      .find(({ event }) => event !== null);
    expect(upcoming).toBeDefined();
    const midpoint = (upcoming!.event!.startTimeDays + upcoming!.event!.endTimeDays) / 2;
    const active = findEclipseInSystem(upcoming!.system, midpoint);
    expect(active?.active).toBe(true);
    expect(active?.waitDays).toBe(0);
  });

  it('returns the same event for the same system and epoch', () => {
    const system = Array.from({ length: 320 }, (_, index) => generateSystem(BigInt(index + 1))).find(
      (candidate) => findEclipseInSystem(candidate, 123) !== null,
    );
    expect(system).toBeDefined();
    expect(findEclipseInSystem(system!, 123)).toEqual(findEclipseInSystem(system!, 123));
  });
});
