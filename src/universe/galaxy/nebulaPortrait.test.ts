import { bakeContinuum } from './nebulaContinuum';
import { describe, expect, it } from 'vitest';
import { cloudsInCell } from './clouds';
import { nebulaFor } from './nebula';
import { finishNebulaBake, planNebulaBake } from './nebulaVolume';
import { measureNebulaPortrait, NebulaPortraitCache, nebulaRayInterval, sampleNebulaPortrait } from './nebulaPortrait';

const cloud = cloudsInCell(15, -5, 0)[0];
function fixture(half: number, density: number) {
  const plan = planNebulaBake(cloud, null, 4, half);
  return finishNebulaBake(plan, { dust: new Float32Array(64).fill(1), hydrogen: new Float32Array(64).fill(density),
    ionized: new Float32Array(64).fill(density), hardness: new Float32Array(64).fill(0.5), transmittance: new Float32Array(64).fill(1) });
}

describe('shared nebula portraits', () => {
  it('measures nested emission once and keeps the actual source shadow', () => {
    const coarse = fixture(2, 3), fine = fixture(1, 6);
    coarse.emissionCoefficient = fine.emissionCoefficient = coarse.emissionHotCoefficient = fine.emissionHotCoefficient = 1;
    const portrait = measureNebulaPortrait({ coarse, fine });
    expect(portrait.luminosities.lines).toBeCloseTo(((64 - 8) * 9 + 8 * 36) * 4 * Math.PI, 7);
    coarse.continuum = bakeContinuum({ size: 4, cellPc: 1, boxPc: 2, originPc: [0, 0, 0],
      sources: [{ positionPc: [0, 0, 0], luminositySolar: 100, color: [1, 1, 1] }] }, () => 0.1);
    const value = new Float64Array(4);
    sampleNebulaPortrait(coarse, 0.5, 0.5, 0.5, value);
    expect(value[0]).toBe(1); expect(value[1]).toBe(9); expect(value[2]).toBeGreaterThan(0);
    coarse.continuum.data.fill(0);
    sampleNebulaPortrait(coarse, 0.5, 0.5, 0.5, value);
    expect(value[2]).toBe(0); expect(value[1]).toBe(9);
  });

  it('clips parallel and oblique rays at the same physical boxes', () => {
    const bake = fixture(2, 3);
    expect(nebulaRayInterval(bake, [0, 0, 0], [1, 0, 0])).toEqual([-2, 2]);
    expect(nebulaRayInterval(bake, [0, 3, 0], [1, 0, 0])).toEqual([0, 0]);
    expect(nebulaRayInterval(bake, [0, 0, 0], [Math.SQRT1_2, Math.SQRT1_2, 0])[1]).toBeCloseTo(2 * Math.SQRT2, 12);
    const value = new Float64Array(4).fill(1);
    sampleNebulaPortrait(bake, 2.01, 0, 0, value);
    expect([...value]).toEqual([0, 0, 0, 0]);
  });

  it('bounds encoded pair payload with LRU eviction and oversized bypass', () => {
    const a = nebulaFor(cloud)!;
    const keys = [a, { ...a }, { ...a }];
    const portrait = measureNebulaPortrait({ coarse: fixture(2, 3), fine: fixture(1, 6) });
    const cost = 2 * (portrait.coarse.data.byteLength + portrait.coarse.occupancy.byteLength);
    const cache = new NebulaPortraitCache(2 * cost);
    cache.put(keys[0], portrait); cache.put(keys[1], portrait); cache.get(keys[0]); cache.put(keys[2], portrait);
    expect(cache.bytes).toBe(2 * cost); expect(cache.get(keys[1])).toBeUndefined();
    expect(cache.get(keys[0])).toBe(portrait); expect(cache.get(keys[2])).toBe(portrait);
    const small = new NebulaPortraitCache(cost - 1); small.put(a, portrait);
    expect(small.bytes).toBe(0); expect(small.get(a)).toBeUndefined();
  });
});
