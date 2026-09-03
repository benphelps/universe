import { describe, expect, it } from 'vitest';
import { BLOOM_INPUT_MAX, BLOOM_LEVELS, CompactBloomPass } from './compactBloom';

describe('compact bloom', () => {
  it('reads the scene through a finite window', () => {
    const pass = new CompactBloomPass(0.18);
    expect(pass.brightShader).toContain(BLOOM_INPUT_MAX.toFixed(2));
    expect(pass.brightShader).toContain('isnan');
    expect(pass.brightShader).toContain('isinf');
  });

  it('keeps a short pyramid whose wings fade', () => {
    expect(BLOOM_LEVELS.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < BLOOM_LEVELS.length; i++) {
      expect(BLOOM_LEVELS[i].weight).toBeLessThan(BLOOM_LEVELS[i - 1].weight);
      expect(BLOOM_LEVELS[i].kernelRadius).toBeGreaterThan(BLOOM_LEVELS[i - 1].kernelRadius);
    }
  });

  it('halves the resolution from the scene down each level', () => {
    const pass = new CompactBloomPass(0.18);
    pass.setSize(1000, 600);
    expect(pass.levelSizes).toEqual([
      [500, 300],
      [250, 150],
      [125, 75],
    ]);
  });
});
