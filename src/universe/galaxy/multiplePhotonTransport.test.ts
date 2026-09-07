import { describe, expect, it } from 'vitest';
import { RECOMBINATION_SCALE } from './ionization';
import { transportPhotons, type PhotonGrid } from './photonTransport';
import { groupPhotonSources, transportMultiplePhotons, type PhotonSource } from './multiplePhotonTransport';

function grid(size: number, density = 10): PhotonGrid {
  return { size, cellPc: 1, sourceCell: [size / 2, size / 2, size / 2], photonRate: 0,
    hydrogen: new Float32Array(size ** 3).fill(density), dust: new Float32Array(size ** 3),
    ionized: new Float32Array(size ** 3), hardness: new Float32Array(size ** 3) };
}
const photons = (radius: number) => RECOMBINATION_SCALE * 100 * 4 * Math.PI / 3 * radius ** 3;
function close(g: PhotonGrid, sources: PhotonSource[]) {
  const ledger = transportMultiplePhotons(g, sources, { maximumIterations: 40, tolerance: 1e-4 });
  expect(Math.abs(ledger.relativeResidual)).toBeLessThan(1e-12);
  expect(ledger.iteration?.converged).toBe(true);
  let recombinations = 0;
  for (let i = 0; i < g.ionized.length; i++) {
    expect(g.ionized[i]).toBeLessThanOrEqual(g.hydrogen[i] * (1 + 1e-6));
    recombinations += g.ionized[i] ** 2 * RECOMBINATION_SCALE * g.cellPc ** 3;
  }
  expect(recombinations / ledger.hydrogenAbsorptionsPerSecond).toBeCloseTo(1, 6);
  return ledger;
}

describe('multiple ionizing sources', () => {
  it('groups only unresolved positions and preserves luminosity and centroid', () => {
    const sources: PhotonSource[] = [
      { sourceCell: [1.1, 2.2, 3.3], photonRate: 1 }, { sourceCell: [1.9, 2.8, 3.7], photonRate: 3 },
      { sourceCell: [3.1, 2.2, 3.3], photonRate: 2 },
    ];
    const result = groupPhotonSources(sources);
    expect(result).toEqual(groupPhotonSources([...sources].reverse()));
    expect(result).toHaveLength(2); expect(result[0].photonRate).toBe(4);
    expect(result[0].sourceCell[0]).toBeCloseTo(1.7, 12);
    expect(result[1].sourceCell).toEqual(sources[2].sourceCell);
  });

  it('recovers one combined source when emitters coincide', () => {
    const a = grid(16), b = grid(16), q = photons(3);
    const reference = transportPhotons({ ...a, photonRate: q });
    const result = close(b, [{ sourceCell: [8, 8, 8], photonRate: q * 0.2 }, { sourceCell: [8, 8, 8], photonRate: q * 0.8 }]);
    expect(result.hydrogenAbsorptionsPerSecond / reference.hydrogenAbsorptionsPerSecond).toBeCloseTo(1, 7);
    let error = 0, total = 0;
    for (let i = 0; i < a.ionized.length; i++) { error += Math.abs(a.ionized[i] ** 2 - b.ionized[i] ** 2); total += a.ionized[i] ** 2; }
    expect(error / total).toBeLessThan(1e-6);
  });

  it('bounds overlapping emission, is symmetric and independent of source order', () => {
    const a = grid(20), b = grid(20), q = photons(4);
    const sources: PhotonSource[] = [{ sourceCell: [7, 10, 10], photonRate: q }, { sourceCell: [13, 10, 10], photonRate: q }];
    const ledger = close(a, sources); close(b, [...sources].reverse());
    expect(ledger.hydrogenAbsorptionsPerSecond / (2 * q)).toBeGreaterThan(0.99);
    let orderError = 0, symmetryError = 0, total = 0;
    for (let k = 0; k < 20; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) {
      const at = (k * 20 + j) * 20 + i, mirror = (k * 20 + j) * 20 + 19 - i;
      orderError += Math.abs(a.ionized[at] ** 2 - b.ionized[at] ** 2);
      symmetryError += Math.abs(a.ionized[at] ** 2 - a.ionized[mirror] ** 2); total += a.ionized[at] ** 2;
    }
    expect(orderError / total).toBeLessThan(1e-6); expect(symmetryError / total).toBeLessThan(1e-6);
  });

  it('retains distinct regions and competes with dust along both paths', () => {
    const a = grid(24), sources: PhotonSource[] = [
      { sourceCell: [5.5, 12.5, 12.5], photonRate: photons(2) }, { sourceCell: [18.5, 12.5, 12.5], photonRate: photons(2) },
    ];
    const clean = close(a, sources);
    expect(a.ionized[(12 * 24 + 12) * 24 + 12]).toBe(0);
    for (const x of [5, 18]) expect(a.ionized[(12 * 24 + 12) * 24 + x]).toBeGreaterThan(9.9);
    const b = grid(24); b.dust.fill(0.2);
    const dusty = close(b, sources);
    expect(dusty.dustAbsorptionsPerSecond).toBeGreaterThan(0);
    expect(dusty.hydrogenAbsorptionsPerSecond).toBeLessThan(clean.hydrogenAbsorptionsPerSecond);
  });

  it('keeps faint sources at their own positions with a bounded, order-independent residual update', () => {
    const sources: PhotonSource[] = [{ sourceCell: [10.5, 10.5, 10.5], photonRate: photons(4) },
      { sourceCell: [2.5, 10.5, 10.5], photonRate: photons(4) * 0.0006 },
      { sourceCell: [17.5, 10.5, 10.5], photonRate: photons(4) * 0.0003 }];
    const a = grid(20), b = grid(20), exact = grid(20);
    const result = transportMultiplePhotons(a, sources, { faintSourceFraction: 0.001 });
    transportMultiplePhotons(b, [...sources].reverse(), { faintSourceFraction: 0.001 });
    transportMultiplePhotons(exact, sources, { maximumIterations: 40, tolerance: 1e-4 });
    expect(result.iteration!.coupledSources).toBe(1);
    expect(result.iteration!.faintSourceFraction).toBeLessThanOrEqual(0.001);
    expect(Math.abs(result.relativeResidual)).toBeLessThan(1e-12);
    expect(a.ionized).toEqual(b.ionized);
    for (const x of [2, 17]) expect(a.ionized[(10 * 20 + 10) * 20 + x]).toBeGreaterThan(0);
    let error = 0, total = 0, measure = 0;
    for (let at = 0; at < a.ionized.length; at++) {
      expect(a.ionized[at]).toBeLessThanOrEqual(a.hydrogen[at] * (1 + 1e-6));
      error += Math.abs(a.ionized[at] ** 2 - exact.ionized[at] ** 2); total += exact.ionized[at] ** 2;
      measure += a.ionized[at] ** 2 * RECOMBINATION_SCALE;
    }
    expect(error / total).toBeLessThan(0.002);
    expect(measure / result.hydrogenAbsorptionsPerSecond).toBeCloseTo(1, 6);
  });

  it('reports failure to converge separately from exact photon closure', () => {
    const a = grid(16);
    const result = transportMultiplePhotons(a, [
      { sourceCell: [5, 8, 8], photonRate: photons(3) }, { sourceCell: [11, 8, 8], photonRate: photons(2) },
    ], { maximumIterations: 1 });
    expect(result.iteration?.converged).toBe(false);
    expect(Math.abs(result.relativeResidual)).toBeLessThan(1e-12);
  });
});
