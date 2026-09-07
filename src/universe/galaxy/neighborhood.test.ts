import { describe, expect, it } from 'vitest';
import { stellarDensity } from './density';
import { NEIGHBOR_RADIUS_PC, neighborRadiusPc } from './neighborhood';

const DISK = { xPc: 8000, yPc: 0, zPc: 0 };
const BULGE = { xPc: 200, yPc: 0, zPc: 20 };

describe('how far the neighborhood reaches', () => {
  it('caps the count budget in dense regions and allows fewer stars in sparse regions', () => {
    // Spiral redistribution can put the home point below the reference.
    // The 30 pc handoff then limits its count; it must not expand the query
    // to force an identical count in sparse inter-arm space.
    const countBudget = 0.1 * 4 * Math.PI / 3 * NEIGHBOR_RADIUS_PC ** 3;
    for (const at of [DISK, BULGE, { xPc: 1800, yPc: 500, zPc: 0 }]) {
      const estimated = stellarDensity(at) * 4 * Math.PI / 3 * neighborRadiusPc(at) ** 3;
      expect(estimated).toBeLessThanOrEqual(countBudget * (1 + 1e-12));
      if (stellarDensity(at) >= 0.1) expect(estimated / countBudget).toBeCloseTo(1, 12);
      else expect(neighborRadiusPc(at)).toBe(NEIGHBOR_RADIUS_PC);
    }
  });

  it('never reaches past where the backdrop takes over', () => {
    // Thirty parsecs is where these points hand off to the sky field's
    // own near radius. Past it the same stars would be drawn twice, so
    // however empty it is out here the reach stops there.
    for (const at of [DISK, BULGE, { xPc: 15000, yPc: 0, zPc: 900 }]) {
      expect(neighborRadiusPc(at)).toBeLessThanOrEqual(NEIGHBOR_RADIUS_PC);
    }
    // The home inter-arm locale stays close to the normal reach.
    expect(neighborRadiusPc(DISK) / NEIGHBOR_RADIUS_PC).toBeGreaterThan(0.95);
  });
});
