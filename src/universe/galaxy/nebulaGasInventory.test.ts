import { describe, expect, it } from 'vitest';
import { CM_PER_PC, PROTON_MASS, SOLAR_MASS } from '../../core/physics/constants';
import { combineGasInventories, NebulaGasAccumulator } from './nebulaGasInventory';
import { cloudsInCell } from './clouds';
import { planNebulaBake, sampleNebulaCpu } from './nebulaVolume';

describe('prescribed nebula gas inventory', () => {
  it('counts a uniform nested volume once, including helium', () => {
    const coarse = new NebulaGasAccumulator(1, { minimum: [2, 2, 2], span: 4 });
    const fine = new NebulaGasAccumulator(0.5);
    for (let k = 0; k < 8; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      // Prescribe a depleted inner region while retaining its old gas
      // in the hidden coarse cells. That duplicate must not count.
      coarse.add(i, j, k, 10, 10);
      fine.add(i, j, k, 10, 2);
    }
    const sum = combineGasInventories(coarse.finish(), fine.finish());
    const massPerUnit = CM_PER_PC ** 3 * 1.4 * PROTON_MASS / SOLAR_MASS;
    expect(sum.natalMassSolar / massPerUnit).toBeCloseTo(512 * 10, 9);
    expect(sum.prescribedMassSolar / massPerUnit).toBeCloseTo(448 * 10 + 64 * 2, 9);
    expect(sum.relativeChange).toBeCloseTo(-0.1, 12);
    expect(sum.netChangeMassSolar / sum.natalMassSolar).toBeCloseTo(-0.1, 12);
    expect(sum.boundaryExchangeMassSolar).toBeNull();
  });

  it('does not invent a ratio for an empty natal domain', () => {
    const cells = new NebulaGasAccumulator(1);
    cells.add(0, 0, 0, 0, 2);
    expect(cells.finish().relativeChange).toBeNull();
    expect(cells.finish().netChangeMassSolar).toBeGreaterThan(0);
  });

  it('leaves a real unlit cloud mass unchanged', () => {
    const cloud = cloudsInCell(15, -5, 0).find(c => c.seed === 0xadb7a33b629c834an)!;
    const fields = sampleNebulaCpu(planNebulaBake(cloud, null, 24));
    expect(fields.gasInventory!.natalMassSolar).toBeGreaterThan(0);
    expect(fields.gasInventory!.relativeChange).toBe(0);
  });
});
