import { describe, expect, it } from 'vitest';
import { cloudsInCell } from './clouds';
import { nebulaFor } from './nebula';
import { bakeNebulaPair, planNebulaPair } from './nebulaPair';
import { planNebulaBake, type NebulaBakePlan } from './nebulaVolume';

// Compact, multiple-source region verified at all tested display grades.
const cloud = cloudsInCell(12, -8, 0).find(c => c.seed === 0x6ad55f2226b4dad6n)!;
const nebula = nebulaFor(cloud)!;

describe('matched nebula bakes', () => {
  it('aligns every display grade and preserves the physical source positions', () => {
    for (const size of [48, 96, 160]) {
      const { coarse, fine, minimum } = planNebulaPair(cloud, nebula, size);
      expect(fine).not.toBeNull();
      const original = planNebulaBake(cloud, nebula, size);
      const ratio = coarse.cellPc / fine!.cellPc;
      expect(ratio).toBeGreaterThan(1);
      expect(fine!.boxPc).toBeGreaterThanOrEqual(original.boxPc);
      for (let axis = 0; axis < 3; axis++) {
        expect((fine!.originPc[axis] - fine!.boxPc + coarse.boxPc) / coarse.cellPc).toBeCloseTo(minimum[axis], 10);
        expect(fine!.originPc[axis] + fine!.ionizePc[axis]).toBeCloseTo(original.originPc[axis] + original.ionizePc[axis], 10);
        expect(fine!.originPc[axis] + fine!.scatterSourcePc[axis]).toBeCloseTo(original.originPc[axis] + original.scatterSourcePc[axis], 10);
        expect(Math.abs(fine!.ionizePc[axis])).toBeLessThan(fine!.boxPc);
        expect(Math.abs(fine!.originPc[axis]) + fine!.boxPc).toBeLessThanOrEqual(coarse.boxPc + 1e-9);
      }
    }
  });

  it('encodes a disjoint pair within its shared budget for either field backend', () => {
    const sample = (plan: NebulaBakePlan) => ({
      hydrogen: new Float32Array(plan.size ** 3).fill(3), dust: new Float32Array(plan.size ** 3).fill(0.1),
      ionized: new Float32Array(plan.size ** 3), hardness: new Float32Array(plan.size ** 3),
      transmittance: new Float32Array(plan.size ** 3).fill(1),
    });
    const pair = bakeNebulaPair(cloud, nebula, 24, sample);
    const ledger = pair.coarse.compositePhotonLedger!;
    expect(pair.fine).not.toBeNull();
    expect(Math.abs(ledger.relativeResidual)).toBeLessThan(1e-10);
    const encoded = pair.coarse.photonAccounting.encodedRecombinationsPerSecond + pair.fine!.photonAccounting.encodedRecombinationsPerSecond;
    expect(encoded / ledger.sourcePhotonsPerSecond).toBeLessThanOrEqual(1);
    expect(pair.coarse.photonAccounting.transport!.sourcePhotonsPerSecond).toBe(0);
    expect(pair.fine!.photonAccounting.transport!.sourcePhotonsPerSecond / nebula.photonRate).toBeCloseTo(1, 14);
  });

  it('transfers every resolved source into absorbing coarse gas without emitting it twice', () => {
    const group = { ...nebula, photonRate: nebula.photonRate * 1000,
      sources: nebula.sources.map(source => ({ ...source, photonRate: source.photonRate * 1000 })) };
    const pair = bakeNebulaPair(cloud, group, 16, plan => ({
      hydrogen: new Float32Array(plan.size ** 3).fill(0.1), dust: new Float32Array(plan.size ** 3),
      ionized: new Float32Array(plan.size ** 3), hardness: new Float32Array(plan.size ** 3),
      transmittance: new Float32Array(plan.size ** 3).fill(1),
    }));
    const inside = pair.fine!.photonAccounting.transport!, outside = pair.coarse.photonAccounting.transport!;
    expect(inside.iteration!.sources).toBeGreaterThan(1);
    expect(inside.iteration!.converged).toBe(true); expect(outside.iteration!.converged).toBe(true);
    expect(outside.hydrogenAbsorptionsPerSecond).toBeGreaterThan(0);
    expect(outside.injectedPhotonsPerSecond / inside.boundaryPhotonsPerSecond).toBeCloseTo(1, 12);
    expect(outside.sourcePhotonsPerSecond).toBe(0);
    expect(Math.abs(pair.coarse.compositePhotonLedger!.relativeResidual)).toBeLessThan(1e-12);
  });

  it('uses one complete domain for an unlit cloud', () => {
    const plan = planNebulaPair(cloud, null, 48);
    expect(plan.fine).toBeNull();
    expect(plan.coarse.photonRate).toBe(0);
    expect(plan.coarse.originPc).toEqual([0, 0, 0]);
  });
});
