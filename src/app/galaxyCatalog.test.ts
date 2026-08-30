import { describe, expect, it, vi } from 'vitest';
import { CATALOG_GALAXIES } from './galaxyCatalog';

/**
 * The catalogue makes claims about eight galaxies, and every one of
 * them is a number this codebase can recompute. So it does: each entry
 * is regenerated from its seed and checked against what the panel will
 * tell the traveler. If the nucleus model ever changes — the bulge
 * relation, the spin draw, the accretion split — these fail, which is
 * the point. A shipped highlight that quietly stopped being true would
 * otherwise be indistinguishable from one that never was.
 *
 * The galaxy seed locks at first use, so each entry needs its own
 * module graph; resetting between them is what makes the sweep possible
 * at all.
 */
describe('the galaxy catalogue', () => {
  for (const entry of CATALOG_GALAXIES) {
    it(`still describes ${entry.name}`, async () => {
      vi.resetModules();
      const { setGalaxySeed } = await import('../universe/galaxy/galaxySeed');
      setGalaxySeed(BigInt(`0x${entry.galaxy}`));
      const { galacticNucleus } = await import('../universe/galaxy/nucleus');
      const nucleus = galacticNucleus();

      expect(nucleus.flow.regime).toBe(entry.regime);
      expect(nucleus.spin).toBeCloseTo(entry.spin, 4);
      expect(nucleus.massSolar / entry.massSolar).toBeCloseTo(1, 3);
      expect(nucleus.flow.eddingtonRatio / entry.eddingtonRatio).toBeCloseTo(1, 3);
    });
  }

  it('spans the range it claims to span', async () => {
    // The point of a catalogue is the spread. If these ever collapse,
    // the entries have stopped being worth having.
    const spins = CATALOG_GALAXIES.map((g) => g.spin);
    const masses = CATALOG_GALAXIES.map((g) => g.massSolar);
    const ratios = CATALOG_GALAXIES.map((g) => g.eddingtonRatio);
    expect(Math.min(...spins)).toBeLessThan(0.1);
    expect(Math.max(...spins)).toBeGreaterThan(0.99);
    expect(Math.max(...masses) / Math.min(...masses)).toBeGreaterThan(1e4);
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeGreaterThan(1e5);
    expect(CATALOG_GALAXIES.some((g) => g.regime === 'thin-disc')).toBe(true);
    expect(CATALOG_GALAXIES.some((g) => g.regime === 'riaf')).toBe(true);
  });

  it('addresses each galaxy exactly once', () => {
    const seeds = new Set(CATALOG_GALAXIES.map((g) => g.galaxy));
    expect(seeds.size).toBe(CATALOG_GALAXIES.length);
    for (const entry of CATALOG_GALAXIES) {
      expect(entry.galaxy).toMatch(/^[0-9a-f]{16}$/);
      expect(entry.seed).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
