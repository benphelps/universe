import { expect, it, vi } from 'vitest';
import type { MolecularCloud } from './clouds';
import { ResidencySelector, type ResidencyQuery } from './residencySelection';
import { residencyWeight } from './residency';
import { nebulaFor, rememberNebula } from './nebula';
import { cloudsInCell } from './clouds';
import { nebulaBakeMemory } from './nebulaBakeMemory';

const clouds: MolecularCloud[] = Array.from({ length: 20 }, (_, i) => ({ seed: BigInt(i + 1),
  positionPc: { xPc: 10 + i * 20, yPc: 0, zPc: 0 }, radiusPc: 10 + i, amplitude: 300 }));
const query: ResidencyQuery = { position: { xPc: 0, yPc: 0, zPc: 0 }, reachPc: 2000,
  minimumAngular: .02, count: 3, pedestal: 1, focused: null };

it('matches direct ranking, retains compact dark entries, and preserves focused-cloud priority', async () => {
  const generate = vi.fn(() => null);
  const selector = new ResidencySelector(32, generate, () => clouds);
  const expected = clouds.map(cloud => ({ cloud, weight: residencyWeight(cloud, null, cloud.positionPc.xPc, 1) }))
    .sort((a,b) => b.weight-a.weight).slice(0,3);
  const first = await selector.select(query);
  expect(first!.chosen.map(({ cloud, weight }) => ({ cloud, weight }))).toEqual(expected);
  expect(first!.built).toBe(20);
  const before = generate.mock.calls.length;
  const repeat = await selector.select(query);
  expect(repeat!.built).toBe(0); expect(generate).toHaveBeenCalledTimes(before);
  const focused = await selector.select({ ...query, focused: clouds[19] });
  expect(focused!.chosen.at(-1)!.cloud).toBe(clouds[19]);
});

it('bounds the cache and cancels without publishing a partial ranking', async () => {
  let generated = 0;
  const selector = new ResidencySelector(8, () => { generated++; return null; }, () => clouds);
  expect(await selector.select(query, () => generated >= 4)).toBeNull();
  expect(generated).toBe(4);
  expect((await selector.select(query))!.cached).toBe(8);
});

it('reuses exact returned nebula metadata without regenerating it on the viewer', () => {
  rememberNebula(clouds[0], null);
  expect(nebulaFor(clouds[0])).toBeNull();
});

it('returns exact lit-cloud admission estimates and reuses them across worker queries', async () => {
  const cloud = cloudsInCell(15, -5, 0).find(c => c.seed === 0xadb7a33b629c834an)!;
  const nebula = nebulaFor(cloud)!;
  const selector = new ResidencySelector(32, () => nebula, () => [cloud]);
  const request = { ...query, position: cloud.positionPc, grades: [48, 96, 160] };
  const first = (await selector.select(request))!.chosen[0];
  for (const size of request.grades) expect(first.estimates[size]).toEqual(nebulaBakeMemory(cloud, nebula, size));
  const next = (await selector.select(request))!.chosen[0];
  expect(next.estimates).toBe(first.estimates);
});
