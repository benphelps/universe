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

  it('separates each pair on something the eye can see', () => {
    // Four entries across two regimes, and within each regime the axis
    // that regime can actually show. Home is not one of the four and
    // does not answer for the spread.
    for (const regime of ['thin-disc', 'riaf'] as const) {
      expect(ofRegime(regime).length).toBe(2);
    }

    // The tori are the temperature pair. Blackbody hue keeps moving
    // below about thirty thousand kelvin and stops above it, so this
    // is the one pair that can be separated that way — and it is, from
    // one side of that line to the other.
    const tori = ofRegime('riaf').map((g) => g.innerTemperatureK).sort((a, b) => a - b);
    expect(tori[0]).toBeLessThan(HUE_FREEZES_K);
    expect(tori[1]).toBeGreaterThan(HUE_FREEZES_K);
    expect(tori[1] / tori[0]).toBeGreaterThan(100);

    // The discs cannot be. Both sit far above that line — the regime
    // needs a percent of Eddington, and the heaviest hole the model
    // grows still lands near 1e5 K — so whatever their temperatures
    // say, they arrive the same colour. What separates them is size,
    // and that is the same fact told twice: T goes as (ṁ/M)^¼, so the
    // colder disc is simply the heavier hole, and the mass is the half
    // of it that reaches the eye.
    const discs = ofRegime('thin-disc');
    for (const disc of discs) expect(disc.innerTemperatureK).toBeGreaterThan(HUE_FREEZES_K);
    const [light, heavy] = discs.sort((a, b) => a.massSolar - b.massSolar);
    expect(heavy.massSolar / light.massSolar).toBeGreaterThan(100);
    expect(heavy.innerTemperatureK).toBeLessThan(light.innerTemperatureK);

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

/** Where blackbody hue stops changing. Past it every flow is the same
 *  blue-white however much hotter it goes — off the model's own table,
 *  28 800 K and 1 432 640 K agree to six percent of one channel. */
const HUE_FREEZES_K = 30000;

function ofRegime(regime: CatalogGalaxy['regime']): CatalogGalaxy[] {
  return CATALOG_GALAXIES.filter((g) => g.regime === regime);
}
