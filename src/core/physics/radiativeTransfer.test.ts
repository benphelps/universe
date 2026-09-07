import { describe, expect, it } from 'vitest';
import { cellEmissionWeight } from './radiativeTransfer';

describe('uniform emitting and absorbing cells', () => {
  it('has the transparent limit without subtractive cancellation', () => {
    expect(cellEmissionWeight(0)).toBe(1);
    expect(cellEmissionWeight(1e-12)).toBeCloseTo(1 - 5e-13, 15);
  });

  it('matches the analytic slab independently of step count and optical depth', () => {
    for (const opacity of [0, 1e-10, 0.1, 1, 100]) {
      const length = 3;
      const j = 7;
      const background = 2;
      const exact = background * Math.exp(-opacity * length) +
        j * length * cellEmissionWeight(opacity * length);
      for (const cells of [1, 2, 17, 256]) {
        const ds = length / cells;
        const depth = opacity * ds;
        let light = 0;
        let transmission = 1;
        for (let i = 0; i < cells; i++) {
          light += transmission * j * ds * cellEmissionWeight(depth);
          transmission *= Math.exp(-depth);
        }
        expect(light + transmission * background).toBeCloseTo(exact, 11);
      }
    }
  });

  it('approaches j/κ rather than diverging or vanishing in thick cells', () => {
    expect(1000 * cellEmissionWeight(1000)).toBeCloseTo(1, 12);
    expect(cellEmissionWeight(1)).toBeCloseTo(1 - Math.exp(-1), 12);
  });
});
