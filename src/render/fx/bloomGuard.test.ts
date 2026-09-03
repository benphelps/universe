import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { describe, expect, it } from 'vitest';
import { BLOOM_INPUT_MAX, COMPACT_BLOOM_FACTORS, guardBloomInput } from './bloomGuard';

describe('bloom input', () => {
  it('bounds HDR glare without changing the scene buffer', () => {
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.18, 0, 1);
    guardBloomInput(bloom);

    expect(bloom.materialHighPassFilter.fragmentShader).toContain(BLOOM_INPUT_MAX.toFixed(2));
  });

  it('strongly suppresses the frame-scale blur mips', () => {
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.18, 0, 1);
    guardBloomInput(bloom);

    expect(bloom.compositeMaterial.uniforms.bloomFactors.value).toEqual([
      ...COMPACT_BLOOM_FACTORS,
    ]);
    expect(COMPACT_BLOOM_FACTORS.at(-1)).toBeLessThan(COMPACT_BLOOM_FACTORS[0] / 50);
  });
});
