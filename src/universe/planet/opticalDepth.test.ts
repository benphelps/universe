import { describe, expect, it } from 'vitest';
import {
  aerosolExtinctionDepth,
  aerosolOpticalDepth,
  atmosphereColumn,
  columnAbove,
  visibleOpticalDepth,
} from './atmosphere';
import type { PlanetAtmosphere, PlanetBulk } from './types';

const earthBulk = { gravityMs2: 9.80665 } as PlanetBulk;
const air = (over: Partial<PlanetAtmosphere>): PlanetAtmosphere => ({
  class: 'nitrogen-oxygen',
  surfacePressureBar: 1,
  scaleHeightKm: 8.5,
  opticalDepth: 0.85,
  scatteringColor: [0.35, 0.55, 1.0],
  ...over,
});

describe('visibleOpticalDepth', () => {
  it("reproduces Earth's blue-heavy tenth of green", () => {
    const [r, g, b] = visibleOpticalDepth(air({}), earthBulk);
    expect(g).toBeCloseTo(0.1, 6);
    expect(b).toBeGreaterThan(g);
    expect(r).toBeLessThan(g);
  });

  it('scales with the column mass: pressure over gravity', () => {
    const [, g] = visibleOpticalDepth(air({ surfacePressureBar: 90 }), { gravityMs2: 8.87 } as PlanetBulk);
    expect(g).toBeGreaterThan(9);
  });

  it('is transparent without an atmosphere', () => {
    expect(visibleOpticalDepth(air({ class: 'none', surfacePressureBar: 0 }), earthBulk)).toEqual([0, 0, 0]);
  });
});

describe('aerosolOpticalDepth', () => {
  it('keeps clear air thin and makes methane haze orange through blue absorption', () => {
    const [r, g, b] = aerosolOpticalDepth(air({}));
    expect(g).toBeLessThan(0.04);
    expect(g).toBeGreaterThan(0.02);
    const [tr, tg, tb] = aerosolOpticalDepth(air({ class: 'nitrogen-methane' }));
    expect(tg).toBeGreaterThan(1);
    expect(tr).toBeGreaterThan(tb);
    const [er, , eb] = aerosolExtinctionDepth(air({ class: 'nitrogen-methane' }));
    expect(eb).toBeGreaterThan(er * 2);
  });
});

describe('columnAbove', () => {
  it('thins low aerosols faster than the molecular gas', () => {
    const column = atmosphereColumn(air({}), earthBulk);
    const above = columnAbove(column, air({}), 8.5);
    expect(above.rayleigh[1]).toBeCloseTo(0.1 / Math.E, 6);
    expect(above.aerosol[1]).toBeCloseTo(0.03 * 0.94 * Math.exp(-1 / 0.22), 6);
    expect(above.aerosolExtinction[1]).toBeCloseTo(0.03 * Math.exp(-1 / 0.22), 6);
    expect(above.aerosolExtinction[1]).toBeLessThan(above.rayleigh[1] * 0.01);
  });

  it('never hides the deck under a hothouse', () => {
    const hothouse = air({ class: 'co2-hothouse', surfacePressureBar: 90, scaleHeightKm: 15 });
    const above = columnAbove(atmosphereColumn(hothouse, earthBulk), hothouse, 20);
    expect(above.rayleigh[1] + above.aerosolExtinction[1]).toBeLessThanOrEqual(0.3 + 1e-9);
  });
});
