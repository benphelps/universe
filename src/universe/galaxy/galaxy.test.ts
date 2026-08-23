import { describe, expect, it } from 'vitest';
import { HOME_POSITION, stellarDensity } from './density';
import { sectorStars, starsNear, viewpointForSeed } from './sectors';
import { buildSkyField, imfFractionAbove } from './skyfield';

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

  it('viewpoints are deterministic and near home', () => {
    const a = viewpointForSeed(0xabc123n);
    expect(viewpointForSeed(0xabc123n)).toEqual(a);
    expect(Math.abs(a.xPc - 8000)).toBeLessThan(200);
    expect(viewpointForSeed(0xdef456n)).not.toEqual(a);
  });
});

describe('sky field', () => {
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
    const sky = buildSkyField(HOME_POSITION);
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

  it('the glow map is brightest toward the midplane band', () => {
    const sky = buildSkyField(HOME_POSITION);
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
