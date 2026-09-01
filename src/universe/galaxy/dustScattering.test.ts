import { describe, expect, it } from 'vitest';
import {
  dustScatterTable,
  hgPhase,
  sampleScatterTable,
  SCATTER_OPACITY_RGB,
  SCATTER_TABLE_TAU_MAX,
  SCATTER_TINT_RGB,
  singleScatterTable,
} from './dustScattering';

describe('the multiple-scattering table', () => {
  const table = dustScatterTable();

  it('reduces to single scattering where nothing stands between', () => {
    // At vanishing depth there is nothing to scatter twice: the table
    // must be the attenuated beam through the phase, and no less.
    for (const mu of [-0.9, -0.3, 0.2, 0.8]) {
      const bare = Math.exp(-0.05) * hgPhase(mu);
      const total = sampleScatterTable(table, 0.05, mu);
      expect(total).toBeGreaterThan(bare * 0.98);
      expect(total).toBeLessThan(bare * 1.35);
    }
  });

  it('only ever adds light to the single-scatter floor', () => {
    const single = singleScatterTable();
    for (let i = 0; i < table.length; i++) {
      expect(table[i]).toBeGreaterThanOrEqual(single[i] * 0.98);
      expect(Number.isFinite(table[i])).toBe(true);
    }
  });

  it('washes the forward peak out with depth', () => {
    // Photons that have scattered on the way forget where they were
    // going: the deeper the point, the flatter its emission over angle.
    const anisotropy = (tau: number): number =>
      sampleScatterTable(table, tau, 0.9) / sampleScatterTable(table, tau, -0.9);
    expect(anisotropy(0.1)).toBeGreaterThan(anisotropy(2));
    expect(anisotropy(2)).toBeGreaterThan(anisotropy(6));
    expect(anisotropy(6)).toBeGreaterThan(1);
  });

  it('fills shadows the beam cannot reach', () => {
    // Behind several depths of dust the direct beam is gone, but the
    // diffuse field seeps around — a clump's shadow glows faintly
    // instead of holding pitch black, as real nebular shadows do.
    for (const mu of [-0.5, 0, 0.5]) {
      const beamOnly = Math.exp(-6) * hgPhase(mu);
      expect(sampleScatterTable(table, 6, mu)).toBeGreaterThan(3 * beamOnly);
    }
    // And still dies toward the table's edge rather than glowing grey.
    expect(sampleScatterTable(table, SCATTER_TABLE_TAU_MAX, 0)).toBeLessThan(
      sampleScatterTable(table, 1, 0),
    );
  });

  it('carries the blue of scattering and the red of transmission', () => {
    // A_B/A_V and A_R/A_V on the diffuse R_V = 3.1 curve, and the
    // sprite's tilt is those ratios at unchanged luminance.
    const [r, g, b] = SCATTER_OPACITY_RGB;
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
    const [tr, tg, tb] = SCATTER_TINT_RGB;
    expect(0.2126 * tr + 0.7152 * tg + 0.0722 * tb).toBeCloseTo(1, 6);
    expect(tb).toBeGreaterThan(tr);
  });
});
