import { describe, expect, it } from 'vitest';
import type { Belt } from '../system/types';
import { instantiateBeltCell, SFD_SLOPE } from './asteroids';

const BELT: Belt = {
  kind: 'main',
  innerAu: 2.1,
  outerAu: 3.3,
  gaps: [{ semiMajorAxisAu: 2.5, widthAu: 0.05, resonance: '3:1' }],
  resonantPopulations: [],
  inclinationDispersionRad: 0.15,
};

describe('belt cell instantiation', () => {
  it('is deterministic per cell and independent across cells', () => {
    const a = instantiateBeltCell(42n, BELT, 7, 200);
    const b = instantiateBeltCell(42n, BELT, 7, 200);
    const c = instantiateBeltCell(42n, BELT, 8, 200);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('follows the size-frequency power law', () => {
    const asteroids: ReturnType<typeof instantiateBeltCell> = [];
    for (let cell = 0; cell < 30; cell++) {
      asteroids.push(...instantiateBeltCell(1n, BELT, cell, 300, 0.5));
    }
    const above = (d: number) => asteroids.filter((a) => a.diameterKm > d).length;
    // N(>1) / N(>10) should be ~10^SFD_SLOPE.
    const measured = Math.log10(above(1) / above(10));
    expect(measured).toBeGreaterThan(SFD_SLOPE - 0.5);
    expect(measured).toBeLessThan(SFD_SLOPE + 0.5);
  });

  it('respects the rubble-pile spin barrier and thins resonance gaps', () => {
    const asteroids = instantiateBeltCell(9n, BELT, 0, 3000);
    let inGap = 0;
    for (const asteroid of asteroids) {
      if (asteroid.rubblePile) {
        expect(asteroid.spinPeriodHours).toBeGreaterThanOrEqual(2.2);
      }
      const aAu = asteroid.elements.semiMajorAxis / 1.495978707e11;
      if (Math.abs(aAu - 2.5) < 0.025) inGap++;
    }
    // The gap keeps ~8% of the density of an equivalent full band.
    expect(inGap / asteroids.length).toBeLessThan(0.02);
  });

  it('shapes get lumpier at small sizes', () => {
    // Large bodies are SFD-rare, so draw them with a raised size floor.
    const small = instantiateBeltCell(5n, BELT, 0, 1500, 0.5).filter((a) => a.diameterKm < 5);
    const large = instantiateBeltCell(5n, BELT, 1, 300, 80);
    const meanElongation = (list: typeof large) =>
      list.reduce((s, a) => s + a.shape.elongation, 0) / list.length;
    expect(small.length).toBeGreaterThan(100);
    expect(meanElongation(small)).toBeLessThan(meanElongation(large));
  });
});
