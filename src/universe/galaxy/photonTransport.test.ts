import { describe, expect, it } from 'vitest';
import { absorbPhotonCell, transportPhotons, type PhotonGrid } from './photonTransport';
import { RECOMBINATION_SCALE, stromgrenRadiusPc } from './ionization';

function grid(size: number, density: number, halfPc = 4): PhotonGrid {
  return { size, cellPc: 2 * halfPc / size, sourceCell: [size / 2, size / 2, size / 2], photonRate: 1e49,
    hydrogen: new Float32Array(size ** 3).fill(density), dust: new Float32Array(size ** 3),
    ionized: new Float32Array(size ** 3), hardness: new Float32Array(size ** 3) };
}

describe('local photon absorption', () => {
  it('spends photons on recombinations and dust, with finite fronts', () => {
    for (const capacity of [0, 0.001, 0.2, 1, 1000]) for (const tau of [0, 1e-9, 0.1, 2, 100]) {
      const cell = absorbPhotonCell(1, capacity, tau);
      expect(cell.outgoing + cell.hydrogen + cell.dust).toBeCloseTo(1, 12);
      expect(cell.hydrogen).toBeCloseTo(capacity * cell.filling, 12);
      expect(cell.filling).toBeGreaterThanOrEqual(0);
      expect(cell.filling).toBeLessThanOrEqual(1);
    }
    expect(absorbPhotonCell(1, 4, 0).filling).toBe(0.25);
    expect(absorbPhotonCell(1, 0, 2).outgoing).toBeCloseTo(Math.exp(-2), 12);
  });

  it('matches subdivision of a uniform dusty slab including a front', () => {
    for (const capacity of [0.1, 2, 100]) for (const tau of [0, 0.01, 2, 100]) {
      const expected = absorbPhotonCell(1, capacity, tau);
      let photons = 1, hydrogen = 0, dust = 0;
      for (let i = 0; i < 128; i++) {
        const cell = absorbPhotonCell(photons, capacity / 128, tau / 128);
        photons = cell.outgoing; hydrogen += cell.hydrogen; dust += cell.dust;
      }
      expect(photons).toBeCloseTo(expected.outgoing, 11);
      expect(hydrogen).toBeCloseTo(expected.hydrogen, 11);
      expect(dust).toBeCloseTo(expected.dust, 11);
    }
  });
});

describe('radial finite-volume photon transport', () => {
  it('keeps vacuum transparent while still absorbing light in dust-only cells', () => {
    const empty = grid(20, 0), dusty = grid(20, 0);
    let litVacuum = 0;
    empty.onCell = (_at, incoming, depth, hydrogen, u) => {
      if (incoming > 0) litVacuum++;
      expect([depth, hydrogen, u]).toEqual([0, 0, 0]);
    };
    const clear = transportPhotons(empty);
    expect(litVacuum).toBeGreaterThan(1000);
    expect(clear.hydrogenAbsorptionsPerSecond).toBe(0);
    expect(clear.dustAbsorptionsPerSecond).toBe(0);
    expect(clear.boundaryPhotonsPerSecond / empty.photonRate).toBeCloseTo(1, 12);
    dusty.dust.fill(.1);
    const absorbed = transportPhotons(dusty);
    expect(absorbed.hydrogenAbsorptionsPerSecond).toBe(0);
    expect(absorbed.dustAbsorptionsPerSecond).toBeGreaterThan(0);
    expect(absorbed.boundaryPhotonsPerSecond).toBeLessThan(clear.boundaryPhotonsPerSecond);
    expect(absorbed.relativeResidual).toBeCloseTo(0, 12);
    expect(dusty.ionized.every(n => n === 0)).toBe(true);
  });

  it('conserves unobstructed photons at centres, faces, edges and vertices', () => {
    for (const source of [[8, 8, 8], [8.5, 8.5, 8.5], [8, 8.5, 8.5], [0, 0, 0], [1.2, 3.7, 14.9]]) {
      const g = grid(16, 0); g.sourceCell = source as [number, number, number];
      const ledger = transportPhotons(g);
      // Sources on the exterior boundary emit a fraction outside the
      // domain immediately; that fraction must remain in the ledger.
      expect(ledger.relativeResidual).toBeCloseTo(0, 11);
      expect(ledger.boundaryPhotonsPerSecond / g.photonRate).toBeCloseTo(1, 11);
    }
  });

  it('never ionizes more gas than exists or spends more than Q', () => {
    const g = grid(24, 1000);
    for (let i = 0; i < g.hydrogen.length; i++) {
      g.hydrogen[i] *= 0.1 + 2 * Math.sin(i * 7.12) ** 2;
      g.dust[i] = 0.2 + (i % 19);
    }
    const ledger = transportPhotons(g);
    let recombinations = 0;
    for (let i = 0; i < g.ionized.length; i++) {
      expect(g.ionized[i]).toBeLessThanOrEqual(g.hydrogen[i]);
      recombinations += g.ionized[i] ** 2 * RECOMBINATION_SCALE * g.cellPc ** 3;
    }
    expect(ledger.relativeResidual).toBeCloseTo(0, 12);
    expect(recombinations / ledger.hydrogenAbsorptionsPerSecond).toBeCloseTo(1, 6);
    expect(recombinations / g.photonRate).toBeLessThanOrEqual(1.000001);
    expect(ledger.dustAbsorptionsPerSecond).toBeGreaterThan(0);
  });

  it('recovers the uniform Strömgren volume as the grid is refined', () => {
    const radius = stromgrenRadiusPc(1e49, 100);
    for (const size of [16, 32, 64]) {
      const g = grid(size, 100, radius * 2);
      const ledger = transportPhotons(g);
      let ionizedVolume = 0;
      for (const n of g.ionized) ionizedVolume += (n / 100) ** 2 * g.cellPc ** 3;
      expect(ionizedVolume / (4 * Math.PI * radius ** 3 / 3)).toBeCloseTo(1, 6);
      expect(ledger.boundaryPhotonsPerSecond / g.photonRate).toBeLessThan(1e-10);
    }
  });

  it('converges spatially toward a sphere, rather than only matching its volume', () => {
    const radius = stromgrenRadiusPc(1e49, 100);
    const errors: number[] = [];
    for (const size of [16, 32, 64]) {
      const g = grid(size, 100, radius * 2);
      transportPhotons(g);
      let moment = 0, volume = 0;
      for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const weight = g.ionized[(k * size + j) * size + i] ** 2;
        const r2 = ((i + 0.5 - size / 2) ** 2 + (j + 0.5 - size / 2) ** 2 + (k + 0.5 - size / 2) ** 2) * g.cellPc ** 2;
        moment += weight * r2; volume += weight;
      }
      errors.push(Math.abs(moment / volume / (0.6 * radius ** 2) - 1));
    }
    expect(errors[1]).toBeLessThan(errors[0]);
    expect(errors[2]).toBeLessThan(errors[1]);
    expect(errors[2]).toBeLessThan(0.05);
  });

  it('keeps gas behind an opaque plane neutral', () => {
    const g = grid(24, 1);
    for (let k = 0; k < 24; k++) for (let j = 0; j < 24; j++) g.hydrogen[(k * 24 + j) * 24 + 15] = 1e6;
    const ledger = transportPhotons(g);
    let litBehind = 0;
    for (let k = 0; k < 24; k++) for (let j = 0; j < 24; j++) for (let i = 16; i < 24; i++) litBehind += g.ionized[(k * 24 + j) * 24 + i];
    expect(litBehind).toBe(0);
    expect(g.ionized[(12 * 24 + 12) * 24 + 13]).toBeGreaterThan(0);
    expect(ledger.relativeResidual).toBeCloseTo(0, 12);
  });
});
