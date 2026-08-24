import { beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng/rng';
import { generateStar } from '../star/generate';
import { HOME_POSITION, stellarDensity } from './density';
import { sceneFromGalaxy } from './orientation';
import { starPhotometry } from './photometry';
import { drawPopulation } from './population';
import { sectorStars, starsNear, viewpointForSeed } from './sectors';
import { buildSkyField, imfFractionAbove, type SkyField } from './skyfield';

describe('galactic density', () => {
  it('matches the solar-neighborhood normalization', () => {
    const local = stellarDensity(HOME_POSITION);
    expect(local).toBeGreaterThan(0.07);
    expect(local).toBeLessThan(0.35);
  });

  it('falls off away from the midplane and with radius', () => {
    const local = stellarDensity(HOME_POSITION);
    expect(stellarDensity({ xPc: 8000, yPc: 0, zPc: 1000 })).toBeLessThan(local * 0.2);
    expect(stellarDensity({ xPc: 16000, yPc: 0, zPc: 20 })).toBeLessThan(local);
    expect(stellarDensity({ xPc: 3000, yPc: 0, zPc: 20 })).toBeGreaterThan(local);
  });
});

describe('sectors', () => {
  it('are deterministic and hold plausible star counts', () => {
    const a = sectorStars(800, 0, 2);
    const b = sectorStars(800, 0, 2);
    expect(JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(
      JSON.stringify(b, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
    // ~0.1/pc³ × 1000 pc³ → tens to a couple hundred stars.
    let total = 0;
    for (let i = 0; i < 10; i++) total += sectorStars(800 + i, 3, 1).length;
    expect(total / 10).toBeGreaterThan(30);
    expect(total / 10).toBeLessThan(400);
  });

  it('starsNear respects the radius', () => {
    const stars = starsNear(HOME_POSITION, 15);
    expect(stars.length).toBeGreaterThan(100);
    for (const star of stars.slice(0, 50)) {
      const d = Math.hypot(
        star.positionPc.xPc - HOME_POSITION.xPc,
        star.positionPc.yPc - HOME_POSITION.yPc,
        star.positionPc.zPc - HOME_POSITION.zPc,
      );
      expect(d).toBeLessThanOrEqual(15);
    }
  });

  it('viewpoints are deterministic, spread across the disk', () => {
    const a = viewpointForSeed(0xabc123n);
    expect(viewpointForSeed(0xabc123n)).toEqual(a);
    expect(viewpointForSeed(0xdef456n)).not.toEqual(a);
    const radii = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const v = viewpointForSeed(BigInt(1000 + i * 7919));
      const radius = Math.hypot(v.xPc, v.yPc);
      expect(radius).toBeGreaterThan(5000);
      expect(radius).toBeLessThan(12100);
      expect(Math.abs(v.zPc)).toBeLessThan(400);
      radii.add(Math.round(radius / 1000));
    }
    // Locales genuinely differ: inner and outer disk both occur.
    expect(radii.size).toBeGreaterThan(3);
  });

  it('sky orientations are deterministic proper rotations that vary', () => {
    const m = sceneFromGalaxy(0xabc123n);
    expect([...sceneFromGalaxy(0xabc123n)]).toEqual([...m]);
    expect([...sceneFromGalaxy(0x123abcn)]).not.toEqual([...m]);
    // Orthonormal rows and positive determinant.
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const dot =
        m[a * 3] * m[b * 3] + m[a * 3 + 1] * m[b * 3 + 1] + m[a * 3 + 2] * m[b * 3 + 2];
      expect(Math.abs(dot)).toBeLessThan(1e-5);
    }
    for (let row = 0; row < 3; row++) {
      const norm = Math.hypot(m[row * 3], m[row * 3 + 1], m[row * 3 + 2]);
      expect(norm).toBeCloseTo(1, 5);
    }
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    expect(det).toBeCloseTo(1, 4);
  });
});

describe('population', () => {
  it('mixes components like the solar neighborhood', () => {
    const counts = { 'thin-disk': 0, 'thick-disk': 0, halo: 0 };
    let old = 0;
    let metalPoor = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const draw = drawPopulation(new Rng(BigInt(50_000 + i)), HOME_POSITION);
      counts[draw.component]++;
      if (draw.ageGyr > 8) old++;
      if (draw.feH < -1) metalPoor++;
      expect(draw.ageGyr).toBeLessThan(13.5);
      expect(draw.feH).toBeGreaterThanOrEqual(-2.5);
      expect(draw.feH).toBeLessThanOrEqual(0.6);
    }
    expect(counts['thin-disk'] / n).toBeGreaterThan(0.8);
    expect(counts['thick-disk'] / n).toBeGreaterThan(0.05);
    expect(counts['thick-disk'] / n).toBeLessThan(0.2);
    expect(counts.halo / n).toBeGreaterThan(0.001);
    expect(counts.halo / n).toBeLessThan(0.03);
    expect(old / n).toBeGreaterThan(0.15);
    expect(old / n).toBeLessThan(0.45);
    expect(metalPoor / n).toBeGreaterThan(0.002);
    expect(metalPoor / n).toBeLessThan(0.04);
  });

  it('components shift with galactic position', () => {
    const at = (zPc: number): number => {
      let halo = 0;
      for (let i = 0; i < 1500; i++) {
        const draw = drawPopulation(new Rng(BigInt(90_000 + i)), { xPc: 8000, yPc: 0, zPc });
        if (draw.component !== 'thin-disk') halo++;
      }
      return halo / 1500;
    };
    // Away from the midplane the thin disk thins out of the mix.
    expect(at(1500)).toBeGreaterThan(at(20) * 3);
  });

  it('metallicity follows the disk radial gradient', () => {
    const meanFeH = (xPc: number): number => {
      let sum = 0;
      for (let i = 0; i < 1500; i++) {
        sum += drawPopulation(new Rng(BigInt(70_000 + i)), { xPc, yPc: 0, zPc: 20 }).feH;
      }
      return sum / 1500;
    };
    expect(meanFeH(4000)).toBeGreaterThan(meanFeH(8000) + 0.1);
    expect(meanFeH(12000)).toBeLessThan(meanFeH(8000) - 0.1);
  });

  it('sky photometry mirrors the full generator', () => {
    for (let i = 0; i < 40; i++) {
      const seed = BigInt(123_000 + i * 17);
      const fast = starPhotometry(seed);
      const full = generateStar(seed, { withCompanions: false });
      expect(fast.luminosity).toBe(full.luminosity);
      expect(fast.tEff).toBe(full.tEff);
    }
  });
});

describe('sky field', () => {
  // One shared build: the full sky (sectors, shells, clouds, glow
  // integral) is the expensive object every assertion inspects.
  let sky: SkyField;
  beforeAll(() => {
    sky = buildSkyField(HOME_POSITION);
  }, 60000);

  it('IMF fraction above mass cuts behaves sanely', () => {
    expect(imfFractionAbove(0.013)).toBeCloseTo(1, 5);
    const f1 = imfFractionAbove(1.3);
    const f3 = imfFractionAbove(3);
    const f8 = imfFractionAbove(8);
    expect(f1).toBeGreaterThan(f3);
    expect(f3).toBeGreaterThan(f8);
    expect(f1).toBeLessThan(0.1);
    expect(f8).toBeGreaterThan(1e-5);
  });

  it('naked-eye star counts from home are the right order of magnitude', () => {
    expect(sky.starCount).toBeGreaterThan(5000);
    let nakedEye = 0;
    for (let i = 0; i < sky.starCount; i++) {
      // m = 4.83 − 2.5·log10(E / E(Sun at 10 pc)).
      const magnitude = 4.83 - 2.5 * Math.log10(sky.starBrightness[i] / 0.01);
      if (magnitude < 6.5) nakedEye++;
    }
    expect(nakedEye).toBeGreaterThan(1500);
    expect(nakedEye).toBeLessThan(40000);
  });

  it('carries clusters and nebulae in the far field', () => {
    expect(sky.nebulae.length).toBeGreaterThan(3);
    expect(sky.nebulae.length).toBeLessThan(120);
    for (const nebula of sky.nebulae) {
      const norm = Math.hypot(...nebula.dir);
      expect(norm).toBeGreaterThan(0.999);
      expect(norm).toBeLessThan(1.001);
      expect(nebula.angularRadius).toBeGreaterThan(0.003);
      expect(nebula.angularRadius).toBeLessThanOrEqual(0.35);
      expect(nebula.brightness).toBeGreaterThan(0);
    }
  });

  it('the glow map is brightest toward the midplane band', () => {
    const rowMean = (row: number): number => {
      let sum = 0;
      for (let c = 0; c < sky.glowWidth; c++) sum += sky.glowData[(row * sky.glowWidth + c) * 4];
      return sum / sky.glowWidth;
    };
    const equator = rowMean(Math.floor(sky.glowHeight / 2));
    const pole = rowMean(sky.glowHeight - 1);
    expect(equator).toBeGreaterThan(pole * 3);
  });
});
