import { describe, expect, it } from 'vitest';
import {
  aerosolExtinctionDepth,
  aerosolOpticalDepth,
  aerosolSurfaceExposure,
  atmosphericBondAlbedo,
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

describe('atmosphericBondAlbedo', () => {
  it('derives a modest clear-Earth contribution from its visible column', () => {
    const albedo = atmosphericBondAlbedo(air({}), earthBulk, [1, 1, 1]);
    expect(albedo).toBeGreaterThan(0.02);
    expect(albedo).toBeLessThan(0.12);
  });

  it('makes a deep scattering CO2 column reflective without a class albedo', () => {
    const albedo = atmosphericBondAlbedo(
      air({ class: 'co2-hothouse', surfacePressureBar: 68 }),
      earthBulk,
      [0.55, 0.7, 1],
    );
    expect(albedo).toBeGreaterThan(0.7);
    expect(albedo).toBeLessThan(1);
  });
});

describe('aerosolOpticalDepth', () => {
  it('keeps clear air thin and makes methane haze orange through blue absorption', () => {
    const [r, g, b] = aerosolOpticalDepth(air({}), earthBulk);
    expect(g).toBeLessThan(0.04);
    expect(g).toBeGreaterThan(0.02);
    const titanBulk = { gravityMs2: 1.352 } as PlanetBulk;
    const titanAir = air({ class: 'nitrogen-methane', surfacePressureBar: 1.47 });
    const [tr, tg, tb] = aerosolOpticalDepth(titanAir, titanBulk);
    expect(tg).toBeGreaterThan(1);
    expect(tr).toBeGreaterThan(tb);
    const [er, , eb] = aerosolExtinctionDepth(titanAir, titanBulk);
    expect(eb).toBeGreaterThan(er * 2);
  });

  it('scales a dusty CO2 column with pressure over gravity', () => {
    const marsAir = air({ class: 'thin-co2', surfacePressureBar: 0.00636 });
    const marsBulk = { gravityMs2: 3.721 } as PlanetBulk;
    const sparseAir = air({ class: 'thin-co2', surfacePressureBar: 0.00107 });
    const sparseBulk = { gravityMs2: 3.527 } as PlanetBulk;
    const mars = aerosolExtinctionDepth(marsAir, marsBulk)[1];
    const sparse = aerosolExtinctionDepth(sparseAir, sparseBulk)[1];
    expect(mars).toBeCloseTo(0.35, 6);
    expect(sparse).toBeGreaterThan(0);
    expect(sparse).toBeLessThan(mars * 0.25);
  });

  it('removes surface-fed mineral dust as an ice sheet covers its source', () => {
    const co2 = air({ class: 'thin-co2', surfacePressureBar: 0.00636 });
    const marsBulk = { gravityMs2: 3.721 } as PlanetBulk;
    const clear = aerosolSurfaceExposure(co2, 0);
    const halfExposed = aerosolSurfaceExposure(co2, Math.PI / 6);
    expect(clear).toBe(0);
    expect(halfExposed).toBeCloseTo(0.5, 8);
    expect(aerosolExtinctionDepth(co2, marsBulk, clear)).toEqual([0, 0, 0]);
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
