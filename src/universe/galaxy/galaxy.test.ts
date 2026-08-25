import { beforeAll, describe, expect, it } from 'vitest';
import { mix64, unmix64 } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { evolve } from '../star/evolution';
import { generateStar } from '../star/generate';
import {
  ageBitsOf,
  ageUnitOf,
  initialMassOf,
  massBitsOf,
  seedForIdentity,
} from '../star/identity';
import { CATALOG_ROWS, luminosityCeiling, starsNear } from './catalog';
import { HOME_POSITION, stellarDensity, stellarDensityCeiling } from './density';
import { sceneFromGalaxy } from './orientation';
import { starPhotometry } from './photometry';
import { populationFromUnit, metallicityFor } from './population';
import { viewpointForSeed } from './sectors';
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

describe('star identity', () => {
  it('unmix64 exactly inverts mix64', () => {
    const rng = new Rng(99n);
    for (let i = 0; i < 200; i++) {
      const x =
        (BigInt(Math.floor(rng.float() * 2 ** 32)) << 32n) |
        BigInt(Math.floor(rng.float() * 2 ** 32));
      expect(unmix64(mix64(x))).toBe(x);
      expect(mix64(unmix64(x))).toBe(x);
    }
  });

  it('constructed seeds decode to their identity bits', () => {
    const rng = new Rng(7n);
    for (let i = 0; i < 200; i++) {
      const massBits = Math.floor(rng.float() * 2 ** 24);
      const ageBits = Math.floor(rng.float() * 2 ** 24);
      const entropy = Math.floor(rng.float() * 2 ** 16);
      const seed = seedForIdentity(massBits, ageBits, entropy);
      expect(massBitsOf(seed)).toBe(massBits);
      expect(ageBitsOf(seed)).toBe(ageBits);
    }
  });

  it('random seeds carry the Kroupa mass distribution', () => {
    let above1 = 0;
    let above7 = 0;
    const n = 40000;
    const rng = new Rng(5n);
    for (let i = 0; i < n; i++) {
      const seed =
        (BigInt(Math.floor(rng.float() * 2 ** 32)) << 32n) |
        BigInt(Math.floor(rng.float() * 2 ** 32));
      const mass = initialMassOf(seed);
      expect(mass).toBeGreaterThanOrEqual(0.013);
      expect(mass).toBeLessThanOrEqual(120);
      if (mass >= 1) above1++;
      if (mass >= 7) above7++;
    }
    expect(above1 / n).toBeGreaterThan(0.05);
    expect(above1 / n).toBeLessThan(0.08);
    expect(above7 / n).toBeGreaterThan(0.002);
    expect(above7 / n).toBeLessThan(0.008);
  });

  it('every seed belongs to exactly one catalog row', () => {
    const rng = new Rng(11n);
    for (let i = 0; i < 500; i++) {
      const seed =
        (BigInt(Math.floor(rng.float() * 2 ** 32)) << 32n) |
        BigInt(Math.floor(rng.float() * 2 ** 32));
      const massBits = massBitsOf(seed);
      const ageBits = ageBitsOf(seed);
      const homes = CATALOG_ROWS.filter(
        (row) =>
          massBits >= row.massBitsLo &&
          massBits < row.massBitsHi &&
          ageBits >= row.ageBitsLo &&
          ageBits < row.ageBitsHi,
      );
      expect(homes.length).toBe(1);
    }
  });

  it('the luminosity ceiling bounds every evolutionary state', () => {
    const rng = new Rng(3n);
    for (let i = 0; i < 3000; i++) {
      const seed =
        (BigInt(Math.floor(rng.float() * 2 ** 32)) << 32n) |
        BigInt(Math.floor(rng.float() * 2 ** 32));
      const mass = initialMassOf(seed);
      const { ageGyr } = populationFromUnit(ageUnitOf(seed), viewpointForSeed(seed));
      expect(evolve(mass, ageGyr).luminosity).toBeLessThanOrEqual(
        luminosityCeiling(mass),
      );
    }
  });
});

describe('catalog', () => {
  it('materializes deterministically with plausible density', () => {
    const a = starsNear(HOME_POSITION, 20);
    const b = starsNear(HOME_POSITION, 20);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < Math.min(a.length, 40); i++) {
      expect(a[i].seed).toBe(b[i].seed);
      expect(a[i].positionPc).toEqual(b[i].positionPc);
    }
    // ~0.1/pc³ over a 20 pc ball → a few thousand stars.
    const volume = (4 / 3) * Math.PI * 20 ** 3;
    expect(a.length).toBeGreaterThan(volume * 0.03);
    expect(a.length).toBeLessThan(volume * 0.4);
  });

  it('starsNear respects the radius and the density ceiling holds', () => {
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
    const rng = new Rng(1n);
    for (let i = 0; i < 300; i++) {
      const corner = {
        xPc: rng.range(-12000, 12000),
        yPc: rng.range(-12000, 12000),
        zPc: rng.range(-800, 800),
      };
      const size = [10, 40, 160, 640][i % 4];
      const ceiling = stellarDensityCeiling(corner, size);
      const probe = {
        xPc: corner.xPc + rng.float() * size,
        yPc: corner.yPc + rng.float() * size,
        zPc: corner.zPc + rng.float() * size,
      };
      expect(stellarDensity(probe)).toBeLessThanOrEqual(ceiling * (1 + 1e-9));
    }
  });

  it('a materialized catalog star mirrors its traveled-to system', () => {
    const stars = starsNear(HOME_POSITION, 12);
    for (const star of stars.slice(0, 12)) {
      const full = generateStar(star.seed, { withCompanions: false });
      expect(full.massInitial).toBeCloseTo(star.massInitial, 10);
      const row = CATALOG_ROWS.find(
        (r) => star.massInitial >= r.massLo && star.massInitial < r.massHi,
      );
      expect(row).toBeDefined();
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
      const rng = new Rng(BigInt(50_000 + i));
      const draw = populationFromUnit(rng.float(), HOME_POSITION);
      const feH = metallicityFor(rng, draw, HOME_POSITION);
      counts[draw.component]++;
      if (draw.ageGyr > 8) old++;
      if (feH < -1) metalPoor++;
      expect(draw.ageGyr).toBeLessThan(13.5);
      expect(feH).toBeGreaterThanOrEqual(-2.5);
      expect(feH).toBeLessThanOrEqual(0.6);
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
        const draw = populationFromUnit(new Rng(BigInt(90_000 + i)).float(), {
          xPc: 8000,
          yPc: 0,
          zPc,
        });
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
        const rng = new Rng(BigInt(70_000 + i));
        const position = { xPc, yPc: 0, zPc: 20 };
        sum += metallicityFor(rng, populationFromUnit(rng.float(), position), position);
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

  it('every far glint with a seed mirrors the star behind it', () => {
    let seeded = 0;
    const step = Math.max(1, Math.floor((sky.starCount - sky.nearStarCount) / 60));
    for (let i = sky.nearStarCount; i < sky.starCount; i += step) {
      const starSeed = sky.starSeeds[i];
      if (starSeed === 0n) continue;
      seeded++;
      const physical = starPhotometry(starSeed);
      const distance = sky.starDistances[i];
      const expected = physical.luminosity / (distance * distance);
      expect(sky.starBrightness[i] / expected).toBeGreaterThan(0.999);
      expect(sky.starBrightness[i] / expected).toBeLessThan(1.001);
      expect(Math.abs(sky.starTeffs[i] - physical.tEff) / physical.tEff).toBeLessThan(1e-3);
    }
    // Cluster/group members lack seeds; catalog stars dominate the sky.
    expect(seeded).toBeGreaterThan(30);
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
