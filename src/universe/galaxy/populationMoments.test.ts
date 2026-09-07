import { describe, expect, it } from 'vitest';
import { integratePopulationMoments, populationMoments } from './populationMoments';
import { componentAgeForUnit, componentUnitForAge, type PopulationComponent } from './populationAge';
import { rgbLuminance } from '../../core/color/optical';

describe('component population quadrature', () => {
  for (const component of ['thin-disk', 'thick-disk', 'halo', 'bulge'] as PopulationComponent[]) {
    it(`resolves short luminous phases in the ${component}`, () => {
      const base = integratePopulationMoments(component, 64);
      const refined = integratePopulationMoments(component, 128);
      expect(Math.abs(base.luminositySolar / refined.luminositySolar - 1)).toBeLessThan(2e-6);
      expect(Math.abs(base.massSolar / refined.massSolar - 1)).toBeLessThan(1e-8);
      const production = populationMoments(component);
      // Production uses generated constants. This independent integration
      // makes a stale table fail when the IMF, age laws or evolution change.
      expect(Math.abs(production.massSolar / refined.massSolar - 1)).toBeLessThan(1e-8);
      expect(Math.abs(production.luminositySolar / refined.luminositySolar - 1)).toBeLessThan(2e-6);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(base.opticalRgbSolar[c] / refined.opticalRgbSolar[c] - 1)).toBeLessThan(2e-6);
        expect(Math.abs(production.opticalRgbSolar[c] / refined.opticalRgbSolar[c] - 1)).toBeLessThan(2e-6);
      }
      expect(rgbLuminance(production.opticalRgbSolar)).toBeGreaterThan(0);
      expect(rgbLuminance(production.opticalRgbSolar)).toBeLessThan(production.luminositySolar);
      for (const u of [0, 0.001, 0.5, 0.999, 1]) {
        expect(componentUnitForAge(component, componentAgeForUnit(component, u))).toBeCloseTo(u, 12);
      }
    }, 20000); // Offline integration now resolves the massive reference-grid knots too.
  }
  it('checks the young nuclear table against independent phase-aware refinement', () => {
    // This densely split age range traverses the massive reference tracks.
    // One independent 128-bin integration is enough to check the generated
    // 256-bin table; running both 64 and 128 here doubles this offline cost.
    const refined = integratePopulationMoments('nuclear-young', 128), production = populationMoments('nuclear-young');
    expect(Math.abs(production.massSolar / refined.massSolar - 1)).toBeLessThan(1e-8);
    expect(Math.abs(production.luminositySolar / refined.luminositySolar - 1)).toBeLessThan(2e-6);
    for (let c = 0; c < 3; c++) expect(Math.abs(production.opticalRgbSolar[c] / refined.opticalRgbSolar[c] - 1)).toBeLessThan(2e-6);
    for (const u of [0, .001, .5, .999, 1]) expect(componentUnitForAge('nuclear-young', componentAgeForUnit('nuclear-young', u))).toBeCloseTo(u, 12);
  }, 20000);
  it('retains different population spectra instead of assigning one tint', () => {
    const young = populationMoments('thin-disk').opticalRgbSolar;
    const old = populationMoments('halo').opticalRgbSolar;
    expect(young[2] / young[0]).toBeGreaterThan(old[2] / old[0]);
  });
});
