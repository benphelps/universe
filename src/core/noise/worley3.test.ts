import { describe, expect, it } from 'vitest';
import { createWorley3 } from './worley3';

/**
 * The lattice is remembered rather than recomputed, which is only safe
 * while the remembering is invisible. These hold the two ways it could
 * stop being: a table that answers differently depending on what was
 * asked first, and a key that disagrees with the hash about which
 * cells are the same cell.
 */
describe('worley3', () => {
  it('answers the same however it was warmed', () => {
    // One sampler asked in a scattered order, another asked the same
    // questions after being walked over a different region first. If
    // the table ever leaked between cells, these would part company.
    const fresh = createWorley3(0x1234abcdn);
    const warmed = createWorley3(0x1234abcdn);
    for (let i = 0; i < 500; i++) warmed(i * 0.7 - 40, i * -0.3 + 11, i * 0.11 - 5);
    for (let i = 0; i < 500; i++) {
      const x = (i % 37) * 0.41 - 7;
      const y = (i % 29) * -0.23 + 4;
      const z = (i % 23) * 0.17 - 2;
      const a = fresh(x, y, z);
      const b = warmed(x, y, z);
      expect(b.f1).toBe(a.f1);
      expect(b.f2).toBe(a.f2);
      expect(b.id1).toBe(a.id1);
    }
  });

  it('gives cells the hash cannot tell apart the same feature point', () => {
    // The hash masks each axis to sixteen bits, so lattice cells 65536
    // apart have always shared a feature point. The table keys on the
    // same masked value, and it has to: key on the raw coordinate and
    // the two would hold different entries for one cell, which is a
    // disagreement no caller could see coming.
    const noise = createWorley3(0x99n);
    for (const offset of [0, 65536, 131072]) {
      const here = noise(0.5 + offset, 0.5 + offset, 0.5 + offset);
      const origin = noise(0.5, 0.5, 0.5);
      // The identity is the table's answer with no arithmetic on top,
      // so it is exactly equal or the key and the hash have parted.
      expect(here.id1).toBe(origin.id1);
      // The distances only agree to the precision doubles have left at
      // that magnitude — cx + offset - x cancels away about four digits
      // by the second wrap. That is the coordinates, not the table.
      expect(here.f1).toBeCloseTo(origin.f1, 9);
      expect(here.f2).toBeCloseTo(origin.f2, 9);
    }
  });

  it('still describes a cellular field', () => {
    const noise = createWorley3(7n);
    for (let i = 0; i < 300; i++) {
      const s = noise(i * 0.13 - 3, i * 0.29 - 8, i * -0.07 + 2);
      expect(s.f1).toBeGreaterThanOrEqual(0);
      expect(s.f2).toBeGreaterThanOrEqual(s.f1);
      expect(s.id1).toBeGreaterThanOrEqual(0);
      expect(s.id1).toBeLessThanOrEqual(1);
      // A feature point sits inside every cell, so the nearest one is
      // never further than the diagonal of the block searched.
      expect(s.f1).toBeLessThan(Math.sqrt(3) * 2);
    }
  });
});
