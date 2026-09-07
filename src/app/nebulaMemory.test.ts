import { expect, it } from 'vitest';
import { NebulaResidentBudget, nebulaResidentBytes, nebulaApparentSize,
  NEBULA_MEMORY_BYTES, NEBULA_WORKING_BYTES, NEBULA_LOOSE_BYTES, NEBULA_RESIDENT_BYTES,
  NEBULA_PORTRAIT_BYTES, NEBULA_RETAINED_WORKER_BYTES } from './nebulaMemory';

it('reserves future paired CPU/GPU uploads, including simultaneous upgrades and fading volumes', () => {
  const memory = new NebulaResidentBudget(nebulaResidentBytes(160) + nebulaResidentBytes(48));
  expect(memory.reserve(1n, 48)).toBe(true);
  expect(memory.reserve(2n, 48)).toBe(true);
  expect(memory.reserve(1n, 160)).toBe(true);
  expect(memory.reserve(2n, 96)).toBe(false);
  expect(memory.reserve(3n, 48)).toBe(false);
  // A late lower grade must not shrink the finer grid's reservation.
  expect(memory.reserve(1n, 48)).toBe(true);
  expect(memory.bytes).toBe(memory.capacity);
  memory.retain(new Set([1n, 2n])); // 2 is still fading.
  expect(memory.reserve(3n, 48)).toBe(false);
  memory.release(2n); memory.release(2n);
  expect(memory.reserve(3n, 48)).toBe(true);
  memory.retain(new Set([3n]));
  expect(memory.bytes).toBe(nebulaResidentBytes(48));
  memory.clear(); expect(memory.bytes).toBe(0);
});

it('allocates every modeled byte once, including idle workers and portrait copies', () => {
  expect(NEBULA_WORKING_BYTES + NEBULA_LOOSE_BYTES + NEBULA_RESIDENT_BYTES
    + NEBULA_PORTRAIT_BYTES + NEBULA_RETAINED_WORKER_BYTES).toBe(NEBULA_MEMORY_BYTES);
  const memory = new NebulaResidentBudget();
  let fine = 0;
  for (let seed = 0n; seed < 64n; seed++) if (memory.reserve(seed, 160)) fine++;
  expect(fine).toBeGreaterThan(0); expect(fine).toBeLessThan(64);
  expect(memory.bytes).toBeLessThanOrEqual(NEBULA_RESIDENT_BYTES);
});

it('does not reserve a nonexistent fine grid for a dark cloud', () => {
  const memory = new NebulaResidentBudget(nebulaResidentBytes(160));
  expect(memory.reserve(1n, 160, 1)).toBe(true);
  expect(memory.reserve(2n, 96, 2)).toBe(true);
  expect(memory.bytes).toBeLessThanOrEqual(memory.capacity);
});

it('uses the scalar box extent to rank near clouds, independent of carrier uniform arrays', () => {
  const near = { box: { halfPc: 80 }, cameraDistancePc: 100, mesh: { material: { uniforms: { uHalfPc: { value: [80, 20, 0, 0] } } } } };
  expect(nebulaApparentSize(near)).toBe(0.8);
  expect(nebulaApparentSize({ ...near, cameraDistancePc: 200 })).toBe(0.4);
  expect(nebulaApparentSize({ ...near, cameraDistancePc: 0 })).toBe(80);
});

it('admits the old and unpublished grids together and releases overlap only on completion', () => {
  const old = nebulaResidentBytes(48, 1), next = nebulaResidentBytes(160, 1);
  const memory = new NebulaResidentBudget(old + next);
  memory.reserve(1n, 48, 1);
  expect(memory.reserve(1n, 160, 1, old)).toBe(true);
  expect(memory.bytes).toBe(old + next);
  expect(memory.reserve(2n, 48, 1)).toBe(false);
  memory.settle(1n, 160, 1);
  expect(memory.bytes).toBe(next);
  expect(memory.reserve(2n, 48, 1)).toBe(true);
  expect(() => memory.settle(2n, 96)).toThrow('Unreserved');
});
