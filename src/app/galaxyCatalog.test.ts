import { describe, expect, it, vi } from 'vitest';
import { seedFromHex } from '../core/rng/hash';
import { galaxyName } from '../universe/galaxy/regions';
import { CATALOG_GALAXIES, HOME_GALAXY, type CatalogGalaxy } from './galaxyCatalog';

/**
 * The catalogue makes claims about four galaxies, and every one of
 * them is a number this codebase can recompute. So it does: each entry
 * is regenerated from its seed and checked against what the folder row
 * will tell the traveler. If the nucleus model ever changes — the
 * bulge relation, the spin draw, the accretion split, the temperature
 * a flow settles at — these fail, which is the point. A shipped
 * destination that quietly stopped being true would otherwise be
 * indistinguishable from one that never was.
 *
 * The galaxy seed locks at first use, so each entry needs its own
 * module graph; resetting between them is what makes the sweep
 * possible at all — and it is the same lock that forces the figures to
 * be carried as data in the first place.
 */
describe('the galaxy catalogue', () => {
  for (const entry of [...CATALOG_GALAXIES, HOME_GALAXY]) {
    it(`still describes ${galaxyName(seedFromHex(entry.galaxy))}`, async () => {
      vi.resetModules();
      const { setGalaxySeed } = await import('../universe/galaxy/galaxySeed');
      setGalaxySeed(seedFromHex(entry.galaxy));
      const { galacticNucleus } = await import('../universe/galaxy/nucleus');
      const nucleus = galacticNucleus();

      expect(nucleus.flow.regime).toBe(entry.regime);
      expect(nucleus.spin).toBeCloseTo(entry.spin, 4);
      expect(nucleus.massSolar / entry.massSolar).toBeCloseTo(1, 3);
      expect(nucleus.flow.eddingtonRatio / entry.eddingtonRatio).toBeCloseTo(1, 3);
      expect(nucleus.flow.innerTemperatureK / entry.innerTemperatureK).toBeCloseTo(1, 3);
      expect(nucleus.flow.opacity / entry.opacity).toBeCloseTo(1, 3);
    });
  }

  it('holds a cold one and a hot one in each regime', () => {
    // The catalogue is built across the two axes that decide what a
    // centre looks like: the shape the flow takes, and how hot it runs
    // inside that shape. Four entries is the smallest set that crosses
    // both, and it is only worth shipping while the pairs stay far
    // enough apart to look like different places. Home is not one of
    // the four and does not answer for the spread.
    for (const [regime, apart] of [
      ['thin-disc', 5],
      ['riaf', 50],
    ] as const) {
      const temperatures = ofRegime(regime).map((g) => g.innerTemperatureK);
      expect(temperatures.length).toBe(2);
      expect(Math.max(...temperatures) / Math.min(...temperatures)).toBeGreaterThan(apart);
    }
    // And the cold one is the heavy one, both times. T goes as
    // (ṁ/M)^¼, so a cold flow is not a dial — it is a bigger hole.
    for (const regime of ['thin-disc', 'riaf'] as const) {
      const [cold, hot] = ofRegime(regime).sort(
        (a, b) => a.innerTemperatureK - b.innerTemperatureK,
      );
      expect(cold.massSolar).toBeGreaterThan(hot.massSolar);
    }
    // Both tori stay see-through. Feeding a hot flow harder raises its
    // temperature and its column together, and past about a half it
    // draws a veil over its own shadow — at which point it has given up
    // the thing that makes the regime worth visiting, and the pick is
    // no longer illustrating what it was chosen to illustrate.
    for (const torus of ofRegime('riaf')) {
      expect(torus.opacity).toBeLessThan(0.5);
    }
  });

  it('addresses each galaxy once, under a name of its own', () => {
    const seeds = new Set([...CATALOG_GALAXIES, HOME_GALAXY].map((g) => g.galaxy));
    expect(seeds.size).toBe(CATALOG_GALAXIES.length + 1);
    // Names are derived rather than written down, so two entries could
    // in principle collide — and two folders reading alike is worse
    // than a name nobody likes.
    const named = [...CATALOG_GALAXIES, HOME_GALAXY];
    const names = new Set(named.map((g) => galaxyName(seedFromHex(g.galaxy))));
    expect(names.size).toBe(named.length);
    for (const entry of named) {
      expect(entry.galaxy).toMatch(/^[0-9a-f]{16}$/);
      expect(entry.seed).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

function ofRegime(regime: CatalogGalaxy['regime']): CatalogGalaxy[] {
  return CATALOG_GALAXIES.filter((g) => g.regime === regime);
}
