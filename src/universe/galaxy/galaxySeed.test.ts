import { describe, expect, it } from 'vitest';
import { galaxySeed, PRIME_GALAXY_SEED, setGalaxySeed } from './galaxySeed';
import { armBoost, waveParams } from './density';
import { sectorName } from './regions';

// This file runs in its own module registry, so committing to a
// non-prime galaxy here cannot leak into the other suites.
describe('a seeded galaxy', () => {
  it('derives its own wave, keeps the ceiling, and locks', () => {
    setGalaxySeed(0xdeadbeefcafe1234n);
    const params = waveParams();
    // A different galaxy, a different spiral.
    expect(params.pitchTan).not.toBeCloseTo(Math.tan((12 * Math.PI) / 180), 6);
    expect(params.ridgePhase).not.toBe(-0.45);
    expect(Math.abs(params.ridgePhase)).toBeLessThanOrEqual(Math.PI);

    // The boost ceiling holds for any galaxy: amplitudes never vary.
    let seed = 99991;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let max = 0;
    for (let i = 0; i < 60000; i++) {
      max = Math.max(max, armBoost(500 + rand() * 16500, -Math.PI + rand() * 2 * Math.PI));
    }
    expect(max).toBeLessThanOrEqual(6.1);

    // Names flow from the galaxy too.
    expect(sectorName({ xPc: 8000, yPc: 0, zPc: 0 }).length).toBeGreaterThan(2);

    // First use locked the seed: the session cannot change galaxies.
    expect(galaxySeed()).toBe(0xdeadbeefcafe1234n);
    expect(() => setGalaxySeed(PRIME_GALAXY_SEED)).toThrow();
    expect(() => setGalaxySeed(0xdeadbeefcafe1234n)).not.toThrow();
  });
});
