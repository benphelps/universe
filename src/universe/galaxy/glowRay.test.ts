import { describe, expect, it, vi } from 'vitest';
import { integrateGalaxyGlowRay } from './glowRay';
import { fieldPopulationMoments } from './fieldPopulation';
import { SCATTER_OPACITY_RGB } from './dustScattering';

const field = vi.hoisted(() => ({ emission: 'all', dust: 'all' }));
vi.mock('./density', () => ({
  DUST_OPACITY_PER_PC: 0.045,
  sightlineDensities: ({ xPc }: { xPc: number }) => ({
    thin: field.emission === 'all' || xPc < 1000 ? 1 : 0, thick: 0, halo: 0, bulge: 0, armBoost: 0,
    dust: field.dust === 'all' || (field.dust === 'behind' && xPc > 3000) ? 0.01 : 0,
  }),
}));
vi.mock('./fieldSelection', () => ({ selectedFieldEmission: () => [0,0,0] }));
vi.mock('./neighborhood', () => ({ neighborRadiusPc: () => 30 }));
vi.mock('./clouds', () => ({ expectedCloudField: () => 0 }));

describe('population-coloured sky transport', () => {
  const origin = { xPc: 0, yPc: 0, zPc: 0 }, dir = [1, 0, 0];
  it('matches the analytic emitting/absorbing slab independently in every channel', () => {
    field.emission = 'all'; field.dust = 'all';
    const observed = integrateGalaxyGlowRay(origin, dir, Infinity);
    const source = fieldPopulationMoments('thin-disk').opticalRgbSolar;
    for (let c = 0; c < 3; c++) {
      const k = 0.045 * 0.01 * 0.45 * SCATTER_OPACITY_RGB[c];
      const expected = source[c] / (4 * Math.PI * k) * (1 - Math.exp(-k * (25000)));
      expect(Math.abs(observed[c] / expected - 1)).toBeLessThan(2e-14);
    }
    expect(observed[2] / observed[0]).toBeLessThan(source[2] / source[0]);
  });

  it('does not redden foreground stars with dust behind them', () => {
    field.emission = 'front'; field.dust = 'none';
    const clear = integrateGalaxyGlowRay(origin, dir, Infinity);
    field.dust = 'behind';
    expect(integrateGalaxyGlowRay(origin, dir, Infinity)).toEqual(clear);
  });

  it('preserves the full dust-free column including the clipped final step', () => {
    field.emission = 'all'; field.dust = 'none';
    const observed = integrateGalaxyGlowRay(origin, dir, Infinity);
    const source = fieldPopulationMoments('thin-disk').opticalRgbSolar;
    for (let c = 0; c < 3; c++) expect(observed[c] / source[c]).toBeCloseTo((25000) / (4 * Math.PI), 10);
  });
});
