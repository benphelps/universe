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
import { CATALOG_ROWS, luminosityCeiling, rowCells, starsNear, type CatalogCell } from './catalog';
import {
  projectSurveys,
  rowSweepRadiusPc,
  surveyCell,
  surveyFrameAt,
  surveyServes,
  sweepRow,
} from './skySurvey';
import type { SweepSlab } from './skyStars';
import { neighborRadiusPc } from './neighborhood';
import { cloudFieldSmoothAt, expectedCloudField } from './clouds';
import {
  ARM_BOOST_MAX,
  armBoost,
  armProfile,
  componentDensities,
  dustDensity,
  HOME_POSITION,
  sightlineDensities,
  stellarDensity,
  stellarDensityCeiling,
  waveParams,
  waveTilt,
} from './density';
import { sceneFromGalaxy } from './orientation';
import { companionLuminosity, starPhotometry } from './photometry';
import { galacticAddress, sectorName, sectorNameForSeed } from './regions';
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

  it('gives the same enhancement whether or not the dust is asked for', () => {
    // armBoost skips the dust lane, and the lane is a second inversion
    // of the orbit family — which is the whole reason it is a separate
    // entry point rather than a field of armProfile's answer. The two
    // have to keep agreeing to the last bit, or the star field and the
    // dust are standing in different galaxies. Exact equality is the
    // right assertion: the split removed work, it did not approximate.
    for (let r = 200; r <= 20000; r += 137) {
      for (let a = 0; a < 6.283; a += 0.41) {
        expect(armBoost(r, a)).toBe(1 + armProfile(r, a).boost);
      }
    }
  });

  it('reaches the same density by the short path as the long one', () => {
    // stellarDensity no longer goes through sightlineDensities, which
    // would have computed a dust lane for it to discard. Same number,
    // to the bit.
    for (const p of [
      HOME_POSITION,
      { xPc: 300, yPc: 120, zPc: 5 },
      { xPc: 5200, yPc: -3100, zPc: 240 },
      { xPc: 16000, yPc: 900, zPc: -1800 },
    ]) {
      const parts = sightlineDensities(p);
      expect(stellarDensity(p)).toBe(parts.thin + parts.thick + parts.halo);
      const components = componentDensities(p);
      expect(components.thin).toBe(parts.thin);
      expect(components.thick).toBe(parts.thick);
      expect(components.halo).toBe(parts.halo);
    }
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

  it('the expected cloud field matches the population it stands in for', () => {
    // The glow integrand replaces per-cloud sums beyond its step scale
    // with expectedCloudField; this pins its Monte Carlo constant to
    // the real population so the stand-in cannot rot.
    let fieldSum = 0;
    let expectedSum = 0;
    for (let i = 0; i < 6000; i++) {
      const radius = 3000 + (i % 200) * 50;
      const azimuth = i * 2.399963229728653;
      const zPc = ((i * 61) % 400) - 200;
      const p = { xPc: radius * Math.cos(azimuth), yPc: radius * Math.sin(azimuth), zPc };
      fieldSum += cloudFieldSmoothAt(p);
      expectedSum += expectedCloudField(dustDensity(p), armBoost(radius, azimuth));
    }
    expect(expectedSum / fieldSum).toBeGreaterThan(0.75);
    expect(expectedSum / fieldSum).toBeLessThan(1.35);
  });

  it('a survey taken with reach projects a neighbouring sky to the bit', () => {
    // The sky coordinator keeps cell surveys from earlier skies and
    // projects them from wherever the traveler lands next. Rows 1, 3
    // and 5 between them exercise the census, the far field and the
    // reach taper; row 0 does the same as row 1 at ten times the cost.
    const home = HOME_POSITION;
    const here = { xPc: home.xPc + 18, yPc: home.yPc + 9, zPc: home.zPc - 6 };
    const frame = surveyFrameAt(home);
    const nearPc = neighborRadiusPc(here);
    for (const rowIndex of [1, 3, 5]) {
      const row = CATALOG_ROWS[rowIndex];
      const whole = sweepRow(row, rowIndex, here);
      expect(whole.near.seeds.length + whole.far.seeds.length).toBeGreaterThan(100);
      const surveys = rowCells(row, here, rowSweepRadiusPc(row)).map((cell) =>
        surveyCell(row, rowIndex, cell, frame),
      );
      expect(surveys.every((survey) => surveyServes(survey, row, here, nearPc))).toBe(true);
      expectSame(whole, [projectSurveys(surveys, CATALOG_ROWS, here)]);
    }
  }, 60000);

  it('a survey serves only within its reach and its census', () => {
    const rowIndex = 3;
    const row = CATALOG_ROWS[rowIndex];
    const nearPc = neighborRadiusPc(HOME_POSITION);
    const cells = rowCells(row, HOME_POSITION, rowSweepRadiusPc(row));
    const distanceOf = (cell: CatalogCell): number =>
      Math.hypot(
        (cell.ix + 0.5) * row.cellPc - HOME_POSITION.xPc,
        (cell.iy + 0.5) * row.cellPc - HOME_POSITION.yPc,
        (cell.iz + 0.5) * row.cellPc - HOME_POSITION.zPc,
      );
    const inner = cells.find((cell) => distanceOf(cell) < 12)!;
    const outer = cells.find((cell) => distanceOf(cell) > 55)!;
    const frame = surveyFrameAt(HOME_POSITION);
    const survey = surveyCell(row, rowIndex, inner, frame);
    expect(surveyServes(survey, row, HOME_POSITION, nearPc)).toBe(true);
    const within = { ...HOME_POSITION, xPc: HOME_POSITION.xPc + frame.reachPc - 1 };
    const beyond = { ...HOME_POSITION, xPc: HOME_POSITION.xPc + frame.reachPc + 1 };
    expect(surveyServes(survey, row, within, nearPc)).toBe(true);
    expect(surveyServes(survey, row, beyond, nearPc)).toBe(false);
    // A survey taken where the disk is dense held a shorter census.
    // Standing where the census reaches further, a cell the census
    // reaches cannot be served from it; one it does not reach can,
    // and so can any cell once the census fits what was held.
    const dense = { ...frame, censusHeldPc: 40 };
    const heldShort = (cell: CatalogCell) => ({ ...survey, cell, frame: dense });
    expect(surveyServes(heldShort(inner), row, HOME_POSITION, nearPc)).toBe(false);
    expect(surveyServes(heldShort(outer), row, HOME_POSITION, nearPc)).toBe(false);
    expect(surveyServes(heldShort(outer), row, HOME_POSITION, 13)).toBe(true);
    expect(surveyServes(heldShort(inner), row, HOME_POSITION, 13)).toBe(true);
    expect(surveyServes(heldShort(inner), row, HOME_POSITION, 21)).toBe(false);
  });

  it('a materialized catalog star mirrors its traveled-to system', () => {
    const stars = starsNear(HOME_POSITION, 12);
    for (const star of stars.slice(0, 12)) {
      // Travel carries the star's true position, so the destination is
      // the very star the sky showed — photometry and all.
      const full = generateStar(star.seed, {
        withCompanions: false,
        localePc: star.positionPc,
      });
      expect(full.massInitial).toBeCloseTo(star.massInitial, 10);
      const fast = starPhotometry(star.seed, star.positionPc);
      expect(full.luminosity).toBe(fast.luminosity);
      expect(full.tEff).toBe(fast.tEff);
      const row = CATALOG_ROWS.find(
        (r) => star.massInitial >= r.massLo && star.massInitial < r.massHi,
      );
      expect(row).toBeDefined();
    }
  });

  it('the luminous age cap covers every galactic locale', () => {
    // Band-B (post-luminous) cells never hold a shining star only if the
    // thin-disk share of the population mix stays under the cap's bound
    // everywhere a traveled-to system can sit.
    const inner = componentDensities({ xPc: 5200, yPc: 0, zPc: 0 });
    const innerThin = (inner.thin / armBoost(5200, 0)) * ARM_BOOST_MAX;
    const bound = (innerThin / (innerThin + inner.thick + inner.halo)) * 1.03;
    for (let r = 400; r <= 16000; r += 400) {
      for (const zPc of [0, 150, 500, 1500, 2500]) {
        const parts = componentDensities({ xPc: r, yPc: 0, zPc });
        const thinMax = (parts.thin / armBoost(r, 0)) * ARM_BOOST_MAX;
        const wThin = thinMax / (thinMax + parts.thick + parts.halo);
        expect(wThin).toBeLessThan(bound);
      }
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

  it('thins toward every edge of its reach instead of stopping on a sphere', () => {
    // The near census ends where the neighbourhood does and each
    // catalog row's sweep ends at a budgeted radius, none of which is
    // a distance any instrument knows. Counted in shells, the star
    // density must fall across each of those edges rather than drop:
    // the census into the magnitude-limited sky over the near taper,
    // and the A–F row's reach at 150 pc and the B row's at 600 pc,
    // which used to end as spheres a pulled-out view drew plainly.
    const density = (a: number, b: number): number => {
      let n = 0;
      for (let i = 0; i < sky.starCount; i++) {
        const d = sky.starDistances[i];
        if (d >= a && d < b) n++;
      }
      return n / ((4 / 3) * Math.PI * (b ** 3 - a ** 3));
    };
    expect(density(30, 40) / density(40, 50)).toBeLessThan(3);
    expect(density(40, 50) / density(50, 60)).toBeLessThan(4);
    expect(density(130, 150) / density(150, 170)).toBeLessThan(2.5);
    expect(density(150, 170) / density(170, 190)).toBeLessThan(3);
    expect(density(550, 600) / density(600, 650)).toBeLessThan(2.5);
    expect(density(600, 650) / density(700, 800)).toBeLessThan(8);
  });

  it('every far glint with a seed mirrors the star behind it', () => {
    let seeded = 0;
    const step = Math.max(1, Math.floor((sky.starCount - sky.nearStarCount) / 60));
    for (let i = sky.nearStarCount; i < sky.starCount; i += step) {
      const starSeed = sky.starSeeds[i];
      if (starSeed === 0n) continue;
      seeded++;
      const distance = sky.starDistances[i];
      // The sky drew this star's population at its true position.
      const physical = starPhotometry(starSeed, {
        xPc: HOME_POSITION.xPc + sky.starDirs[i * 3] * distance,
        yPc: HOME_POSITION.yPc + sky.starDirs[i * 3 + 1] * distance,
        zPc: HOME_POSITION.zPc + sky.starDirs[i * 3 + 2] * distance,
      });
      const luminosity =
        physical.luminosity +
        companionLuminosity(starSeed, {
          xPc: HOME_POSITION.xPc + sky.starDirs[i * 3] * distance,
          yPc: HOME_POSITION.yPc + sky.starDirs[i * 3 + 1] * distance,
          zPc: HOME_POSITION.zPc + sky.starDirs[i * 3 + 2] * distance,
        });
      const expected = luminosity / (distance * distance);
      expect(sky.starBrightness[i] / expected).toBeGreaterThan(0.999);
      expect(sky.starBrightness[i] / expected).toBeLessThan(1.001);
      expect(Math.abs(sky.starTeffs[i] - physical.tEff) / physical.tEff).toBeLessThan(1e-3);
    }
    // Cluster/group members lack seeds; catalog stars dominate the sky.
    expect(seeded).toBeGreaterThan(30);
  });

  it('charts and letters the local territories', () => {
    expect(sky.sectorBounds.length).toBeGreaterThan(60);
    expect(sky.sectorLabels.length).toBeGreaterThan(3);
    expect(sky.sectorLabels.filter((l) => l.home).length).toBe(1);
    for (const label of sky.sectorLabels) expect(label.name.length).toBeGreaterThan(2);
  });

  it('cuts the sky into constellations named for its own landmarks', () => {
    expect(sky.constellationBounds.length).toBeGreaterThan(60);
    expect(sky.constellationLabels.length).toBeGreaterThan(2);
    // Every constellation is organized by a nebula or rift this very
    // sky renders, under the same name the hover gives the object.
    const landmarkNames = new Set(
      [...sky.nebulae, ...sky.darkClouds].map((patch) => sectorNameForSeed(patch.seed)),
    );
    for (const label of sky.constellationLabels) {
      expect(landmarkNames.has(label.name)).toBe(true);
    }
    // Each region's brightest addressable glint is its α — a handful
    // of stars per sky, named for the region that holds them.
    expect(sky.bayerNames.size).toBeGreaterThan(2);
    expect(sky.bayerNames.size).toBeLessThanOrEqual(28);
    const seeds = new Set(sky.starSeeds);
    for (const [seed, name] of sky.bayerNames) {
      expect(seeds.has(seed)).toBe(true);
      expect(name.startsWith('α ')).toBe(true);
    }
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
    // The map stores column radiance directly — the display law is
    // the shader's — so the physical contrast reads straight off.
    const rowMean = (row: number): number => {
      let sum = 0;
      for (let c = 0; c < sky.glowWidth; c++) sum += sky.glowData[(row * sky.glowWidth + c) * 4];
      return sum / sky.glowWidth;
    };
    const equator = rowMean(Math.floor(sky.glowHeight / 2));
    const pole = rowMean(sky.glowHeight - 1);
    expect(equator).toBeGreaterThan(pole * 3);
    // And the sky's own measured floor is the darkest column, in the
    // band's units: positive, and under any row's mean.
    expect(sky.skyFloorRadiance).toBeGreaterThan(0);
    expect(sky.skyFloorRadiance).toBeLessThanOrEqual(pole);
  });
});

describe('gazetteer', () => {
  it('addresses are deterministic and structurally sane', () => {
    const a = galacticAddress({ xPc: -7920, yPc: 7086, zPc: 382 });
    expect(galacticAddress({ xPc: -7920, yPc: 7086, zPc: 382 })).toEqual(a);
    expect(a.sector.length).toBeGreaterThan(2);
    expect(a.label).toContain('Sector');

    expect(galacticAddress({ xPc: 600, yPc: 300, zPc: 0 }).zone).toBe('core');
    expect(galacticAddress({ xPc: 14500, yPc: 2000, zPc: 0 }).zone).toBe('rim');
    expect(galacticAddress({ xPc: 8000, yPc: 0, zPc: 2000 }).zone).toBe('halo');
    // A point on an arm ridge is in that arm: the ridge is the
    // density wave's crowding caustic.
    const radius = 8000;
    const ridgeAzimuth = waveTilt(radius) + waveParams().ridgePhase;
    const onArm = galacticAddress({
      xPc: radius * Math.cos(ridgeAzimuth),
      yPc: radius * Math.sin(ridgeAzimuth),
      zPc: 0,
    });
    expect(onArm.zone).toBe('arm');
  });

  it('territories are contiguous, distinct, and deterministic', () => {
    // Nearby points share a territory; a wide spread crosses many.
    const home = sectorName({ xPc: 8100, yPc: 40, zPc: 0 });
    expect(sectorName({ xPc: 8115, yPc: 52, zPc: 120 })).toBe(home);
    expect(sectorName({ xPc: 8100, yPc: 40, zPc: 0 })).toBe(home);
    const names = new Set<string>();
    for (let ix = 0; ix < 6; ix++) {
      for (let iy = 0; iy < 6; iy++) {
        names.add(sectorName({ xPc: 4000 + ix * 1800, yPc: -4000 + iy * 1800, zPc: 0 }));
      }
    }
    expect(names.size).toBeGreaterThan(25);
  });
});

/** Two sweeps hold the same stars, in the same order, to the bit. */
function expectSame(whole: SweepSlab, parts: SweepSlab[]): void {
  for (const field of ['near', 'far'] as const) {
    const mergedDirs: number[] = [];
    const mergedSeeds: bigint[] = [];
    for (const part of parts) {
      mergedDirs.push(...part[field].dirs);
      mergedSeeds.push(...part[field].seeds);
    }
    expect(Float32Array.from(mergedDirs)).toEqual(whole[field].dirs);
    expect(BigUint64Array.from(mergedSeeds)).toEqual(whole[field].seeds);
  }
}
