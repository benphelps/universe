import { describe, expect, it } from 'vitest';
import { transportPhotons, type PhotonGrid } from './photonTransport';
import { prepareNestedPhotonTransfer, finishNestedPhotonTransfer, transportNestedPhotons } from './nestedPhotonTransport';
import { RECOMBINATION_SCALE, stromgrenRadiusPc } from './ionization';

function grid(size: number, cellPc: number, sourceCell: [number, number, number], density = 30): PhotonGrid {
  return { size, cellPc, sourceCell, photonRate: 1e49,
    hydrogen: new Float32Array(size ** 3).fill(density), dust: new Float32Array(size ** 3),
    ionized: new Float32Array(size ** 3), hardness: new Float32Array(size ** 3) };
}

describe('coupled inner and outer photon domains', () => {
  it('sums each wholly contained fine face into its unique coarse destination', () => {
    const minimum: [number, number, number] = [4, 6, 8];
    const source: [number, number, number] = [10.5, 13.5, 12.5];
    const outer = grid(20, 1, source.map((p, a) => minimum[a] + p / 3) as [number, number, number], 0);
    const inner = grid(24, 1 / 3, source, 0);
    const expected = new Float64Array(6 * 8 * 8);
    // At integer refinement every fine face has exactly one recipient;
    // simply bin the independent inner sweep's outgoing photon fractions.
    transportPhotons({ ...inner, onBoundary(face, i, j, k, fraction) {
      const [u, v] = face < 2 ? [j, k] : face < 4 ? [i, k] : [i, j];
      expected[(face * 8 + Math.floor(v / 3)) * 8 + Math.floor(u / 3)] += fraction;
    } });
    const result = prepareNestedPhotonTransfer(outer, inner, minimum);
    expect(result.faceFractions).toEqual(expected);
    expect(result.directBoundaryFraction).toBe(0);
    expect(result.faceFractions.reduce((sum, n) => sum + n, 0)).toBeCloseTo(1, 12);
  });

  it('retains six boundary planes and rejects a mismatched continuation', () => {
    const outer = grid(32, 1, [16, 16, 16]);
    const inner = grid(24, 8 / 24, [12, 12, 12]);
    const transfer = prepareNestedPhotonTransfer(outer, inner, [12, 12, 12]);
    expect(transfer.faceFractions.byteLength).toBe(6 * 8 ** 2 * 8);
    expect(transfer.faceFractions.byteLength).toBeLessThan(outer.size ** 3 * 8 / 50);
    const wrong = { ...outer, sourceCell: [15, 16, 16] as [number, number, number] };
    expect(() => finishNestedPhotonTransfer(wrong, transfer)).toThrow(/match/);
    expect(finishNestedPhotonTransfer(outer, transfer).combined.relativeResidual).toBeCloseTo(0, 12);
  });

  it('reproduces a single grid when partitioning without refinement', () => {
    const source: [number, number, number] = [10.3, 11.7, 12.2];
    const full = grid(24, 0.4, source);
    const outer = grid(24, 0.4, source);
    const inner = grid(8, 0.4, [2.3, 3.7, 4.2]);
    for (const g of [full, outer, inner]) g.dust.fill(0.1);
    const single = transportPhotons(full);
    const pair = transportNestedPhotons(outer, inner, [8, 8, 8]);
    expect(pair.combined.relativeResidual).toBeCloseTo(0, 12);
    expect(pair.outer.sourcePhotonsPerSecond).toBe(0);
    expect(pair.outer.injectedPhotonsPerSecond / pair.inner.boundaryPhotonsPerSecond).toBeCloseTo(1, 12);
    expect(pair.combined.hydrogenAbsorptionsPerSecond / single.hydrogenAbsorptionsPerSecond).toBeCloseTo(1, 12);
    for (let k = 0; k < 24; k++) for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++) {
      const at = (k * 24 + j) * 24 + i;
      const inside = [i, j, k].every(v => v >= 8 && v < 16);
      const actual = inside ? inner.ionized[((k - 8) * 8 + j - 8) * 8 + i - 8] : outer.ionized[at];
      expect(actual).toBeCloseTo(full.ionized[at], 5);
      if (inside) expect(outer.ionized[at]).toBe(0);
    }
  });

  it('closes the displayed disjoint emission inventory across refinement and clipping', () => {
    for (const [innerSize, span] of [[16, 4], [24, 5], [25, 7]]) {
    for (const minimum of [[4, 4, 4], [0, 6, 8], [16 - span, 16 - span, 16 - span]] as [number, number, number][]) {
      for (const density of [0, 10, 1000]) {
        const source = minimum.map(v => v + span * 0.625) as [number, number, number];
        const outer = grid(16, 1, source, density);
        const inner = grid(innerSize, span / innerSize, [innerSize * 0.625, innerSize * 0.625, innerSize * 0.625], density);
        outer.dust.fill(0.03); inner.dust.fill(0.03);
        const pair = transportNestedPhotons(outer, inner, minimum);
        let emission = 0;
        for (const g of [outer, inner]) for (const n of g.ionized) emission += n ** 2 * g.cellPc ** 3 * RECOMBINATION_SCALE;
        expect(pair.combined.relativeResidual).toBeCloseTo(0, 12);
        expect(emission / outer.photonRate).toBeLessThanOrEqual(1.000001);
        expect(emission / outer.photonRate).toBeCloseTo(pair.combined.hydrogenAbsorptionsPerSecond / outer.photonRate, 6);
      }
    }
    }
  });

  it('carries a front beyond the inner grid and recovers the Strömgren volume', () => {
    const radius = stromgrenRadiusPc(1e49, 100);
    const outer = grid(48, radius / 12, [24, 24, 24], 100);
    const inner = grid(32, outer.cellPc / 4, [16, 16, 16], 100);
    const pair = transportNestedPhotons(outer, inner, [20, 20, 20]);
    expect(pair.inner.boundaryPhotonsPerSecond / outer.photonRate).toBeGreaterThan(0.5);
    expect(pair.outer.hydrogenAbsorptionsPerSecond / outer.photonRate).toBeGreaterThan(0.5);
    expect(pair.combined.hydrogenAbsorptionsPerSecond / outer.photonRate).toBeCloseTo(1, 10);
    let volume = 0, moment = 0;
    for (const g of [outer, inner]) for (let k = 0; k < g.size; k++) for (let j = 0; j < g.size; j++) for (let i = 0; i < g.size; i++) {
      const weight = (g.ionized[(k * g.size + j) * g.size + i] / 100) ** 2 * g.cellPc ** 3;
      const r2 = [i, j, k].reduce((sum, v, axis) => sum + ((v + 0.5 - g.sourceCell[axis]) * g.cellPc) ** 2, 0);
      volume += weight; moment += weight * r2;
    }
    expect(volume / (4 * Math.PI * radius ** 3 / 3)).toBeCloseTo(1, 6);
    expect(Math.abs(moment / volume / (0.6 * radius ** 2) - 1)).toBeLessThan(0.1);
  });

  it('rejects overlapping or misaligned partitions instead of silently dropping photons', () => {
    const outer = grid(16, 1, [8, 8, 8]);
    const inner = grid(16, 0.25, [8, 8, 8]);
    expect(() => transportNestedPhotons(outer, inner, [6.1, 6, 6])).toThrow(/align/);
    inner.sourceCell[0] = 0;
    expect(() => transportNestedPhotons(outer, inner, [8, 6, 6])).toThrow(/strictly/);
  });
});
