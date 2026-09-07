import { describe, expect, it } from 'vitest';
import { findSurfaceEclipses, observerDiscs } from './eclipseGeometry';

const geometry = (t: number) => ({
  star: { x: 1000, y: 0, z: 0 },
  caster: {
    x: 10 * Math.cos(2 * Math.PI * (t - 0.5)),
    y: 10 * Math.sin(2 * Math.PI * (t - 0.5)),
    z: 0,
  },
});
const options = {
  geometry,
  bodyRadius: 1,
  starRadius: 10,
  casterRadius: 0.3,
  startDays: 0,
  windowDays: 1,
  shortestPeriodDays: 1,
  minimumObscuration: 0.5,
};

describe('arbitrary surface eclipses', () => {
  it('refines a real ground event and brackets both contacts', () => {
    const event = findSurfaceEclipses(options)[0];
    expect(event).toBeDefined();
    expect(event.obscuration).toBeCloseTo(1, 5);
    const surface = {
      x: event.surfaceDirection[0],
      y: event.surfaceDirection[1],
      z: event.surfaceDirection[2],
    };
    const at = (t: number) => observerDiscs(geometry(t), surface, 1, 10, 0.3);
    expect(at(event.timeDays).obscuration).toBeCloseTo(event.obscuration, 7);
    expect(Math.abs(at(event.startTimeDays).margin)).toBeLessThan(1e-7);
    expect(Math.abs(at(event.endTimeDays).margin)).toBeLessThan(1e-7);
    expect(at(event.arrivalTimeDays).margin).toBeLessThan(0);
    expect(at(event.endTimeDays + 0.00001).margin).toBeLessThan(0);
    expect(
      findSurfaceEclipses({ ...options, startDays: event.timeDays, windowDays: 0 }).length,
    ).toBeGreaterThan(0);
  });
  it('finds short small-planet transits between time samples', () => {
    const events = findSurfaceEclipses({
      ...options,
      bodyRadius: 0.0001,
      casterRadius: 0.004,
      minimumObscuration: 0.001,
      planetaryTransit: true,
    });
    expect(events.some((e) => e.kind === 'transit')).toBe(true);
    expect(events[0].obscuration).toBeLessThan(0.01);
  });
  it('rejects behind-star bodies and inclined misses', () => {
    expect(
      findSurfaceEclipses({
        ...options,
        geometry: (t) => ({ star: geometry(t).star, caster: { x: 2000, y: 0, z: 0 } }),
      }),
    ).toEqual([]);
    expect(
      findSurfaceEclipses({
        ...options,
        geometry: (t) => ({ star: geometry(t).star, caster: { ...geometry(t).caster, z: 5 } }),
      }),
    ).toEqual([]);
  });
});
