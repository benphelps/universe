import { describe, expect, it } from 'vitest';
import { buildSpiralStructure, spiralProfile, SPIRAL_LIMITS } from './spiralStructure';
import { ARM_BOOST_MAX, DUST_FACTOR_MAX } from './density';

const seeds = ['53494d5f554e4956', '638fa1989d88dbbc', '9d6bf2111a538d4c', '2869ffa2dfd906df', '62765c1caafc1d12'];
describe('finite conservative spiral structure', () => {
  it.each(seeds)('conserves every annulus in stars and dust for galaxy %s', seed => {
    const model = buildSpiralStructure(BigInt('0x' + seed));
    for (const radius of [0, 510, 1937, 3141, 5263, 8099, 12633, 18211, 23999, 35000]) {
      let star = 0, dust = 0, starMin = Infinity, starMax = -Infinity, dustMin = Infinity, dustMax = -Infinity;
      for (let i = 0; i < 4096; i++) {
        const theta = (i + 0.5) * 2 * Math.PI / 4096;
        const p = spiralProfile(radius, theta, model);
        star += p.boost / 4096; dust += p.lane / 4096;
        starMin = Math.min(starMin, 1 + p.boost); starMax = Math.max(starMax, 1 + p.boost);
        dustMin = Math.min(dustMin, 1 + 1.4 * p.lane); dustMax = Math.max(dustMax, 1 + 1.4 * p.lane);
      }
      expect(starMin).toBeGreaterThan(0.52); expect(starMax).toBeLessThanOrEqual(ARM_BOOST_MAX);
      expect(dustMin).toBeGreaterThan(0.7); expect(dustMax).toBeLessThanOrEqual(DUST_FACTOR_MAX);
      expect(Math.abs(star)).toBeLessThan(1e-7);
      expect(Math.abs(dust)).toBeLessThan(1e-7);
      const left = spiralProfile(radius, -Math.PI + 1e-10, model);
      const right = spiralProfile(radius, Math.PI + 1e-10, model);
      expect(left.boost).toBeCloseTo(right.boost, 12);
      expect(left.lane).toBeCloseTo(right.lane, 12);
    }
  });

  it('varies arm geometry across seeds and stays bounded across a morphology ensemble', () => {
    const counts = new Set<number>(), families = new Set<string>();
    for (let seed = 0n; seed < 32n; seed++) {
      const m = buildSpiralStructure(seed);
      counts.add(m.arms.length); families.add(m.family);
      for (const arm of m.arms) {
        expect(Math.max(...arm.pitchDegrees) - Math.min(...arm.pitchDegrees)).toBeGreaterThan(5);
        expect(arm.endPc - arm.startPc).toBeGreaterThan(3000);
      }
      expect(m.spines.filter(s => s.kind === 'branch').length).toBeGreaterThanOrEqual(m.arms.length);
      expect(m.spines.some(s => s.kind === 'bar')).toBe(m.barRadiusPc > 0);
      expect(m.arms[0].endPc).not.toBe(m.arms[1].endPc);
      for (let i = 0; i < 2000; i++) {
        const p = spiralProfile((i * 7919) % SPIRAL_LIMITS.radiusMaxPc, i * 0.61803398875, m);
        expect(1 + p.boost).toBeGreaterThan(0.52);
        expect(1 + p.boost).toBeLessThanOrEqual(ARM_BOOST_MAX);
        expect(1 + 1.4 * p.lane).toBeGreaterThan(0.7);
        expect(1 + 1.4 * p.lane).toBeLessThanOrEqual(DUST_FACTOR_MAX);
      }
    }
    expect(counts.has(2)).toBe(true);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(7);
    expect(families.size).toBe(3);
    const a = buildSpiralStructure(42n), b = buildSpiralStructure(42n);
    expect(a.arms).toEqual(b.arms);
    for (let i = 0; i < 100; i++) expect(spiralProfile(7919 * i % 22000, i, a)).toEqual(spiralProfile(7919 * i % 22000, i, b));
  });
});
