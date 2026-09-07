import { describe, expect, it } from 'vitest';
import { RECOMBINATION_SCALE, stromgrenRadiusPc } from './ionization';
import { nebulaPhotonAccounting } from './nebulaAccounting';

describe('final nebula photon accounting', () => {
  it('closes an analytic uniform Strömgren sphere without a correction', () => {
    const q = 1e49;
    const n = 100;
    const r = stromgrenRadiusPc(q, n);
    const em = n * n * 4 * Math.PI * r ** 3 / 3;
    const ledger = nebulaPhotonAccounting(q, em, em);
    expect(ledger.demandToSupply).toBeCloseTo(1, 12);
    expect(ledger.displayNormalization).toBeCloseTo(1, 12);
    expect(ledger.encodingRelativeError).toBe(0);
  });

  it('exposes excess recombinations even when display normalization hides them', () => {
    const q = 1e47;
    const em = 232 * q / RECOMBINATION_SCALE;
    const ledger = nebulaPhotonAccounting(q, em, em * 0.99);
    expect(ledger.demandToSupply).toBeCloseTo(232, 10);
    expect(ledger.displayNormalization).toBeCloseTo(1 / (232 * 0.99), 12);
    expect(ledger.encodingRelativeError).toBeCloseTo(-0.01, 12);
    expect(ledger.hBetaErgPerSecond).toBeGreaterThan(q * 4.5e-13 * 231);
  });

  it('does not invent escaped photons or undefined ratios for dark clouds', () => {
    const ledger = nebulaPhotonAccounting(0, 0, 0);
    expect(ledger.demandToSupply).toBeNull();
    expect(ledger.displayNormalization).toBeNull();
    expect(ledger.encodingRelativeError).toBeNull();
    expect(ledger.recombinationsPerSecond).toBe(0);
  });
});
