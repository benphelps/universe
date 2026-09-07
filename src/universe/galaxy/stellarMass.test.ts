import { describe, expect, it } from 'vitest';
import { bulgeDensity, bulgeDensityModel, centralSpheroid, nuclearStarCluster } from './spheroid';
import { galaxyBulgeStarCount, galaxyFieldStarCounts, galaxyFieldStellarMass, galaxyNuclearStarCount, galaxyStarCount, galaxyStellarMass } from './stellarMass';
import { fieldPopulationMoments } from './fieldPopulation';
import { populationFromUnit } from './population';
import { componentDensities, stellarDensity, stellarDensityCeiling } from './density';

describe('the shared galaxy component inventory', () => {
  it('allocates the bulge and its nuclear cluster exactly once', () => {
    const total = galaxyStellarMass();
    const field = galaxyFieldStellarMass();
    const bulge = centralSpheroid().massSolar;
    const cluster = nuclearStarCluster().massSolar;
    expect((field + bulge) / total).toBeCloseTo(1, 12);
    expect(cluster).toBeLessThan(bulge);
    expect((galaxyBulgeStarCount() * fieldPopulationMoments('bulge').massSolar + cluster) / bulge).toBeCloseTo(1, 12);
    const counts = galaxyFieldStarCounts();
    expect((counts.thin + counts.thick + counts.halo + galaxyBulgeStarCount() + galaxyNuclearStarCount()) / galaxyStarCount()).toBeCloseTo(1, 12);
  });

  it('integrates the resolved bulge density back to its allocated stars', () => {
    const { scalePc } = bulgeDensityModel();
    let count = 0;
    const steps = 12000;
    const dlog = Math.log(1e14) / steps;
    for (let i = 0; i < steps; i++) {
      const lo = scalePc * 1e-6 * Math.exp(i * dlog);
      const hi = lo * Math.exp(dlog);
      const r = Math.sqrt(lo * hi);
      count += bulgeDensity(r) * 4 * Math.PI * (hi ** 3 - lo ** 3) / 3;
    }
    expect(count / galaxyBulgeStarCount()).toBeCloseTo(1, 5);
    expect(Number.isFinite(bulgeDensity(0))).toBe(true);
    expect(bulgeDensity(0)).toBeGreaterThan(bulgeDensity(scalePc));
  });

  it('puts the same old bulge population in the actual catalogue density', () => {
    const p = { xPc: 100, yPc: 0, zPc: 0 };
    const parts = componentDensities(p);
    expect(parts.bulge).toBe(bulgeDensity(100));
    expect(stellarDensity(p)).toBe(parts.thin + parts.thick + parts.halo + parts.bulge);
    let bulge = 0;
    for (let i = 0; i < 10000; i++) {
      const star = populationFromUnit((i + 0.5) / 10000, p);
      if (star.component === 'bulge') {
        bulge++;
        expect(star.ageGyr).toBeGreaterThanOrEqual(8);
      }
    }
    expect(bulge / 10000).toBeCloseTo(parts.bulge / stellarDensity(p), 3);
    const ceiling = stellarDensityCeiling({ xPc: -20, yPc: -20, zPc: -20 }, 100);
    for (const xPc of [-20, 0, 25, 80]) for (const yPc of [-20, 0, 80]) for (const zPc of [-20, 0, 80]) {
      expect(stellarDensity({ xPc, yPc, zPc })).toBeLessThanOrEqual(ceiling);
    }
  });
});
