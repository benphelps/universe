import { describe, expect, it } from 'vitest';
import { SIGMA_SB } from '../../core/physics/constants';
import { Rng } from '../../core/rng/rng';
import { computeBulk } from './bulk';
import { deriveCirculation } from './circulation';
import { deriveGiantAtmosphere, giantCloudPalette, giantTemperatureK } from './giantAtmosphere';
import { GIANT_REFERENCES, giantFixture } from './__fixtures__/giants';

describe('generated giant atmospheres', () => {
  it('shares cloud chemistry with the renderer, including the Saturn regression', () => {
    for (const reference of GIANT_REFERENCES) {
      const physical = giantFixture(reference);
      const circulation = deriveCirculation(physical);
      const summary = physical.appearance.banding!;
      expect(circulation.atmosphere).toBe(summary.atmosphere);
      expect(summary.zoneColor).toEqual(circulation.atmosphere.palette.zone);
      expect(circulation.atmosphere.temperatureK).toBe(physical.climate.effectiveK);
      if (reference.name === 'Saturn') expect(summary.zoneColor[0]).toBeGreaterThan(summary.zoneColor[2]);
    }
  });
  it('changes cloud families continuously across the old temperature cutoffs', () => {
    for (const temperature of [75, 90, 98, 220, 250, 300, 700, 750, 900, 1100]) {
      const before = giantCloudPalette(temperature - .001), after = giantCloudPalette(temperature + .001);
      for (const key of Object.keys(before) as Array<keyof typeof before>) {
        for (let c = 0; c < 3; c++) expect(Math.abs(before[key][c] - after[key][c])).toBeLessThan(.001);
      }
    }
  });
  it('cools and contracts with age while preserving the reference Jupiter radius', () => {
    const young = giantFixture({ age: .1 }), mature = giantFixture(), old = giantFixture({ age: 9 });
    expect(mature.bulk.radiusEarth).toBeCloseTo(11.2, 8);
    expect(young.bulk.radiusEarth).toBeGreaterThan(mature.bulk.radiusEarth);
    expect(old.bulk.radiusEarth).toBeLessThan(mature.bulk.radiusEarth);
    expect(young.interior.heatFluxWm2).toBeGreaterThan(10 * mature.interior.heatFluxWm2);
    expect(old.interior.heatFluxWm2).toBeLessThan(mature.interior.heatFluxWm2);
    expect(young.climate.effectiveK).toBeGreaterThan(mature.climate.effectiveK!);
    expect(mature.interior.heatFluxWm2).toBeGreaterThan(4);
    expect(mature.interior.heatFluxWm2).toBeLessThan(7);
  });
  it('generates quiet and active ice-rich interiors without injecting test heat', () => {
    const fluxes = Array.from({ length: 60 }, (_, i) => giantFixture({
      seed: BigInt(i), mass: 17, orbit: 25, type: 'ice-giant',
    }).interior.heatFluxWm2);
    expect(Math.min(...fluxes)).toBeLessThan(.12);
    expect(Math.max(...fluxes)).toBeGreaterThan(.4);
    expect(giantFixture({ seed: 41n, mass: 17, type: 'ice-giant' }))
      .toEqual(giantFixture({ seed: 41n, mass: 17, type: 'ice-giant' }));
  });
  it('joins the 150-Earth-mass radius branches continuously', () => {
    const radius = (mass: number) => computeBulk(new Rng(1n), mass, 'gas-giant', 110, 10, .33).radiusEarth;
    expect(Math.abs(radius(150 - 1e-6) - radius(150 + 1e-6))).toBeLessThan(1e-6);
  });
  it('sets cloud-layer separation from pressure and scale height, not planet radius', () => {
    const p = giantFixture();
    const a = deriveGiantAtmosphere(p.climate, p.interior, p.atmosphere, p.bulk, p.rotation);
    const b = deriveGiantAtmosphere(p.climate, p.interior, { ...p.atmosphere, scaleHeightKm: p.atmosphere.scaleHeightKm * 2 }, p.bulk, p.rotation);
    expect(a.upperPressureBar).toBeLessThan(a.deckPressureBar);
    expect(a.upperAltitudeKm / p.atmosphere.scaleHeightKm).toBeCloseTo(Math.log(a.deckPressureBar / a.upperPressureBar));
    expect(b.upperAltitudeKm).toBeCloseTo(2 * a.upperAltitudeKm);
    expect(b.reliefKm).toBeCloseTo(2 * a.reliefKm);
  });
  it('conserves absorbed plus intrinsic power across the displaced temperature field', () => {
    const p = giantFixture(GIANT_REFERENCES[4]), state = p.appearance.banding!.atmosphere!;
    expect(state.hotspotOffsetRad).toBeGreaterThan(0);
    expect(state.hotspotOffsetRad).toBeLessThan(Math.PI / 2);
    expect(giantTemperatureK(state, 1)).toBeGreaterThan(giantTemperatureK(state, -1));
    // Equal-area rings about the hotspot axis integrate the complete sphere.
    let flux = 0;
    for (let i = 0; i < 1000; i++) flux += SIGMA_SB * giantTemperatureK(state, 2 * (i + .5) / 1000 - 1) ** 4 / 1000;
    expect(flux).toBeCloseTo(SIGMA_SB * p.climate.equilibriumK ** 4 + p.interior.heatFluxWm2, 6);
    const uniform = giantFixture().appearance.banding!.atmosphere!;
    expect(giantTemperatureK(uniform, -1)).toBe(giantTemperatureK(uniform, 1));
  });
});
