import { describe, expect, it } from 'vitest';
import { buildSpiralStructure, spiralCellContrastCeiling, spiralProfile } from './spiralStructure';
import { Rng } from '../../core/rng/rng';

describe('finite spiral proposal bounds', () => {
  it('bounds interpolated fields inside cells, including seam, core and branch ends', () => {
    const rng = new Rng(23n);
    for (let seed = 0n; seed < 12n; seed++) {
      const model = buildSpiralStructure(seed);
      for (let cell = 0; cell < 120; cell++) {
        const size = [10, 250, 640, 3000][cell % 4];
        const x = cell === 0 ? -size / 2 : rng.range(-22000, 22000);
        const y = cell === 0 ? -size / 2 : rng.range(-22000, 22000);
        const bound = spiralCellContrastCeiling(x, y, size, model);
        for (let i = 0; i < 64; i++) {
          const px = x + size * (i < 4 ? i % 2 : rng.float());
          const py = y + size * (i < 4 ? Math.floor(i / 2) : rng.float());
          const profile = spiralProfile(Math.hypot(px, py), Math.atan2(py, px), model);
          expect(profile.boost).toBeLessThanOrEqual(bound.boost + 1e-12);
          expect(profile.lane).toBeLessThanOrEqual(bound.lane + 1e-12);
        }
      }
    }
  });
});
