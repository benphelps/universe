import { describe, expect, it } from 'vitest';
import { galaxySeed, PRIME_GALAXY_SEED, setGalaxySeed } from './galaxySeed';
import { armBoost, ARM_BOOST_MAX } from './density';
import { spiralStructure } from './spiralStructure';
import { sectorName } from './regions';

// This file runs in its own module registry, so committing to a
// non-prime galaxy here cannot leak into the other suites.
describe('a seeded galaxy', () => {
  it('derives its own structure, keeps the ceiling, and locks', () => {
    setGalaxySeed(0xdeadbeefcafe1234n);
    const params = spiralStructure();
    expect(params.arms.length).toBeGreaterThanOrEqual(2);
    expect(params.arms.length).toBeLessThanOrEqual(9);
    expect(params.arms[0].pitchDegrees[0]).not.toBe(12);

    // The boost ceiling holds for any galaxy: the total ridge budget bounds every seed.
    let seed = 99991;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let max = 0;
    for (let i = 0; i < 60000; i++) {
      max = Math.max(max, armBoost(500 + rand() * 16500, -Math.PI + rand() * 2 * Math.PI));
    }
    expect(max).toBeLessThanOrEqual(ARM_BOOST_MAX);

    // Names flow from the galaxy too.
    expect(sectorName({ xPc: 8000, yPc: 0, zPc: 0 }).length).toBeGreaterThan(2);

    // First use locked the seed: the session cannot change galaxies.
    expect(galaxySeed()).toBe(0xdeadbeefcafe1234n);
    expect(() => setGalaxySeed(PRIME_GALAXY_SEED)).toThrow();
    expect(() => setGalaxySeed(0xdeadbeefcafe1234n)).not.toThrow();
  });
});
