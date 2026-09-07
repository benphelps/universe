import { expect, it } from 'vitest';
import { cloudsInCell } from './clouds';
import { nebulaFor } from './nebula';
import { nebulaBakeWorkingBytes, nebulaBakeMemory } from './nebulaBakeMemory';
import { bakeNebulaPair } from './nebulaPair';

it('prices actual nested gas fields, encoded payloads and transport workspaces before allocation', () => {
  // Compact, multiple-source region verified at all tested display grades.
  const cloud = cloudsInCell(12, -8, 0).find(c => c.seed === 0x6ad55f2226b4dad6n)!;
  const nebula = nebulaFor(cloud)!;
  expect(nebulaBakeMemory(cloud, null, 96).domains).toBe(1);
  expect(nebulaBakeMemory(cloud, nebula, 96).domains).toBe(2);
  const size = 16;
  const pair = bakeNebulaPair(cloud, nebula, size, plan => ({
    hydrogen: new Float32Array(plan.size ** 3).fill(1), dust: new Float32Array(plan.size ** 3).fill(0.1),
    ionized: new Float32Array(plan.size ** 3), hardness: new Float32Array(plan.size ** 3),
    transmittance: new Float32Array(plan.size ** 3).fill(1),
  }));
  expect(pair.fine).not.toBeNull();
  const bakes = [pair.coarse, pair.fine!];
  const payload = bakes.reduce((sum, bake) => sum + bake.data.byteLength + bake.occupancy.byteLength
    + (bake.continuum?.data.byteLength ?? 0), 0);
  const workspace = Math.max(...bakes.map(bake => bake.photonAccounting.transport?.iteration?.workspaceBytes ?? 0));
  expect(nebulaBakeWorkingBytes(cloud, nebula, size)).toBeGreaterThan(payload + workspace + 40 * size ** 3);
  for (const grade of [48, 96, 160]) {
    const dark = nebulaBakeWorkingBytes(cloud, null, grade);
    const lit = nebulaBakeWorkingBytes(cloud, nebula, grade);
    expect(Number.isFinite(lit)).toBe(true);
    expect(lit).toBeGreaterThan(dark);
    expect(lit).toBeGreaterThan(nebulaBakeWorkingBytes(cloud, nebula, grade / 2));
  }
});
