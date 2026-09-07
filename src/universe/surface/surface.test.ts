import { mu } from '../../core/physics/units';
import { describe, expect, it } from 'vitest';
import { generateStar } from '../star/generate';
import { characterizePlanet, type CharacterizeContext } from '../planet/characterize';
import { computeZones } from '../system/zones';
import { G, SOLAR_MASS, AU } from '../../core/physics/constants';
import type { PlanetClass } from '../system/types';
import { buildChunkMesh } from './chunkMesh';
import { faceUvToDir } from './cubeSphere';
import { createSurfaceField, surveyOf } from './field';
import { SCATTER_STRIDE, scatterForChunk, scatterLevel } from './scatter';
import { localSurfaceTemperatureK } from './params';
import { atmosphericColumnProfile } from '../planet/thermodynamics';
import { columnStateAt } from '../planet/hydrostaticColumn';

const SUN = generateStar(1n, { massInitial: 1, ageGyr: 4.6, feH: 0, withCompanions: false });
const CONTEXT: CharacterizeContext = {
  star: SUN,
  centralLuminosity: SUN.luminosity,
  mu: mu(G * SOLAR_MASS),
  zones: computeZones(SUN.luminosity, SUN.tEff, SUN.ageGyr, 1),
};

function world(
  seed: bigint,
  planetClass: PlanetClass,
  massEarth: number,
  aAu: number,
  options?: Parameters<typeof createSurfaceField>[2],
) {
  const physical = characterizePlanet(
    seed,
    planetClass,
    massEarth,
    {
      semiMajorAxis: aAu * AU,
      eccentricity: 0.02,
      inclination: 0,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    },
    CONTEXT,
  );
  return createSurfaceField(seed.toString(16).padStart(16, '0'), physical, options);
}

function sampleDirs(n: number) {
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.399963229728653;
    dirs.push({ x: r * Math.cos(phi), y, z: r * Math.sin(phi) });
  }
  return dirs;
}

describe('surface field', () => {
  const earthLike = world(11n, 'rocky', 1, 1);
  const moonLike = world(21n, 'rocky', 0.012, 1.05);
  const marsLike = world(13n, 'rocky', 0.107, 1.52);
  const lavaPhysical = characterizePlanet(
    13n,
    'rocky',
    0.9,
    {
      semiMajorAxis: 0.035 * AU,
      eccentricity: 0.02,
      inclination: 0,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    },
    CONTEXT,
  );
  const lavaLike = createSurfaceField('000000000000000d', {
    ...lavaPhysical,
    interior: { ...lavaPhysical.interior, regime: 'magma' },
    climate: {
      ...lavaPhysical.climate,
      surfaceMeanK: 2200,
      hydrosphere: 'magma',
      oceanCoverage: 1,
      dayNightDeltaK: 0,
    },
  });

  it('uses the same local temperature branch as the column, including its cap and cold-datum limit', () => {
    const physical = characterizePlanet(11n, 'rocky', 1, {
      semiMajorAxis: AU, eccentricity: 0.02, inclination: 0, longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0,
    }, CONTEXT);
    for (const dir of sampleDirs(12)) {
      const datum = localSurfaceTemperatureK(earthLike.params, dir, 0);
      const column = atmosphericColumnProfile(physical.atmosphere, physical.climate, physical.bulk, datum)!;
      for (const altitude of [0, 1000, 5000, 100000]) {
        expect(localSurfaceTemperatureK(earthLike.params, dir, altitude)).toBe(columnStateAt(column, altitude).temperatureK);
      }
    }
    const cold = { ...earthLike.params, temperatureField: undefined, surfaceMeanK: 150, atmosphericCapK: 200 };
    expect(localSurfaceTemperatureK(cold, { x: 1, y: 0, z: 0 }, 0)).toBe(150);
    expect(localSurfaceTemperatureK(cold, { x: 1, y: 0, z: 0 }, 100000)).toBe(150);
    expect(localSurfaceTemperatureK(moonLike.params, { x: 1, y: 0, z: 0 }, 100000))
      .toBe(localSurfaceTemperatureK(moonLike.params, { x: 1, y: 0, z: 0 }, 0));
  });

  it('is deterministic', () => {
    const again = world(11n, 'rocky', 1, 1);
    for (const dir of sampleDirs(50)) {
      expect(again.heightAt(dir)).toBe(earthLike.heightAt(dir));
    }
  });

  it('a deferred grid attaching a survey matches the full build exactly', () => {
    const deferred = world(11n, 'rocky', 1, 1, { deferGrid: true });
    expect(deferred.climate).toBeNull();
    expect(deferred.drainage).toBeNull();
    const survey = surveyOf(earthLike);
    expect(survey).not.toBeNull();
    deferred.finishGrid!(survey!);
    expect(deferred.climate).not.toBeNull();
    expect(deferred.drainage).not.toBeNull();
    for (const dir of sampleDirs(40)) {
      expect(deferred.heightAt(dir)).toBe(earthLike.heightAt(dir));
      expect(deferred.waterLevelAt(dir)).toBe(earthLike.waterLevelAt(dir));
    }
  });

  it('flooded fraction matches the climate ocean coverage', () => {
    const target = earthLike.params.oceanCoverage;
    expect(target).toBeGreaterThan(0.2);
    let flooded = 0;
    const dirs = sampleDirs(2000);
    for (const dir of dirs) {
      if (earthLike.heightAt(dir) < earthLike.seaLevelM) flooded++;
    }
    expect(flooded / dirs.length).toBeGreaterThan(target - 0.06);
    expect(flooded / dirs.length).toBeLessThan(target + 0.06);
  });

  it('airless dead worlds are crater-rough; eroded worlds are smooth', () => {
    expect(moonLike.params.craterAmplitude).toBeGreaterThan(0.5);
    expect(earthLike.params.craterAmplitude).toBeLessThan(0.2);

    // High-frequency roughness: height deltas over short arcs.
    const roughness = (field: typeof earthLike): number => {
      let sum = 0;
      const dirs = sampleDirs(400);
      for (const dir of dirs) {
        const near = { x: dir.x + 0.004, y: dir.y, z: dir.z };
        const length = Math.hypot(near.x, near.y, near.z);
        sum += Math.abs(
          field.heightAt(dir) -
            field.heightAt({ x: near.x / length, y: near.y / length, z: near.z / length }),
        );
      }
      return sum / dirs.length;
    };
    expect(roughness(moonLike)).toBeGreaterThan(roughness(earthLike) * 0.8);
  });

  it('lower gravity yields taller relief', () => {
    expect(marsLike.params.reliefM).toBeGreaterThan(earthLike.params.reliefM * 1.3);
  });

  it('turns a surface above the liquidus into one terrain-free fluid shell', () => {
    expect(lavaLike.params.fullyMolten).toBe(true);
    expect(lavaLike.params.magmaCoverage).toBe(1);
    expect(lavaLike.params.reliefM).toBe(0);
    expect(lavaLike.seaLevelM).toBe(0);
    for (const dir of sampleDirs(40)) expect(lavaLike.heightAt(dir)).toBe(0);

    const chunk = buildChunkMesh(lavaLike, 0, 3, 2, 5, 16);
    expect(chunk.waterPositions).not.toBeNull();
  });

  it('colors stay in gamut everywhere', () => {
    for (const dir of sampleDirs(300)) {
      const h = earthLike.heightAt(dir);
      const color = earthLike.colorAt(dir, h, 0.9);
      for (const c of color) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('waves flatten the shore band below upland slopes', () => {
    const norm = (p: { x: number; y: number; z: number }) => {
      const l = Math.hypot(p.x, p.y, p.z);
      return { x: p.x / l, y: p.y / l, z: p.z / l };
    };
    // A short probe: it must stay inside the wave-worked band to see it.
    const stepRad = 12 / earthLike.params.radiusM;
    const slopeAt = (dir: { x: number; y: number; z: number }): number => {
      const east = norm({ x: -dir.z, y: 0, z: dir.x });
      const a = earthLike.heightAt(norm({
        x: dir.x + east.x * stepRad, y: dir.y, z: dir.z + east.z * stepRad,
      }));
      return Math.abs(a - earthLike.heightAt(dir)) / 12;
    };
    // Bisect dry/wet sample pairs down to the waterline. Medians, not
    // sums: some coasts are honest wave-cut cliffs and should stay steep.
    const beachSlopes: number[] = [];
    const dirs = sampleDirs(2000);
    for (let i = 0; i < dirs.length - 1 && beachSlopes.length < 100; i++) {
      let dry = dirs[i];
      let wet = dirs[i + 1];
      if (earthLike.heightAt(dry) < earthLike.seaLevelM) [dry, wet] = [wet, dry];
      if (earthLike.heightAt(dry) < earthLike.seaLevelM) continue;
      if (earthLike.heightAt(wet) >= earthLike.seaLevelM) continue;
      for (let b = 0; b < 40; b++) {
        const mid = norm({ x: (dry.x + wet.x) / 2, y: (dry.y + wet.y) / 2, z: (dry.z + wet.z) / 2 });
        if (earthLike.heightAt(mid) - earthLike.seaLevelM > 0.5) dry = mid;
        else wet = mid;
      }
      beachSlopes.push(slopeAt(dry));
    }
    const uplandSlopes: number[] = [];
    for (const dir of dirs) {
      const rel = earthLike.heightAt(dir) - earthLike.seaLevelM;
      if (rel > 10 && rel < 400) uplandSlopes.push(slopeAt(dir));
    }
    const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1];
    expect(beachSlopes.length).toBeGreaterThan(5);
    expect(uplandSlopes.length).toBeGreaterThan(20);
    expect(median(beachSlopes)).toBeLessThan(median(uplandSlopes) * 0.6);
  });

  it('keeps low growth sparse, deterministic, and restricted to wet mild ground', () => {
    const natural = world(19n, 'rocky', 1, 1);
    const field = {
      ...natural,
      params: { ...natural.params, biosphere: true, oceanCoverage: 0.5, surfaceMeanK: 294, poleDeltaK: 0 },
      heightAt: () => 10,
      waterLevelAt: () => -Infinity,
      climate: { ...natural.climate!, precipAt: () => 1000 },
    };
    const level = scatterLevel(field.params.radiusM);
    const tile = 2 ** (level - 1);
    let rocks = 0, growth = 0;
    for (let x = tile; x < tile + 8; x++) {
      for (let y = tile; y < tile + 8; y++) {
        const data = scatterForChunk(field, 4, level, x, y, [0, 0, 0]);
        expect(data).toEqual(scatterForChunk(field, 4, level, x, y, [0, 0, 0]));
        if (!data) continue;
        for (let i = 0; i < data.length; i += SCATTER_STRIDE) {
          expect(data[i + 5]).toBeLessThan(2);
          if (data[i + 5] === 1) {
            growth++;
            expect(data[i + 3] * 1000).toBeLessThanOrEqual(0.65);
          } else rocks++;
          expect(Math.hypot(data[i + 9], data[i + 10], data[i + 11])).toBeCloseTo(1, 5);
        }
      }
    }
    expect(growth).toBeGreaterThan(0);
    expect(growth).toBeLessThan(rocks * 0.15);
    // Refinement and coarsening add no second population.
    expect(scatterForChunk(field, 4, level + 1, tile * 2, tile * 2, [0, 0, 0])).toBeNull();
    expect(scatterForChunk(field, 4, level - 1, tile / 2, tile / 2, [0, 0, 0])).toBeNull();
    // Local lakes count, even though this synthetic world's sea is dry.
    expect(scatterForChunk({ ...field, waterLevelAt: () => 20 }, 4, level, tile, tile, [0, 0, 0])).toBeNull();
    for (const dry of [
      { ...field, climate: { ...field.climate, precipAt: () => 0 } },
      { ...field, params: { ...field.params, biosphere: false } },
      { ...field, params: { ...field.params, globalIce: true } },
    ]) {
      for (let x = tile; x < tile + 4; x++) {
        const data = scatterForChunk(dry, 4, level, x, tile, [0, 0, 0]);
        for (let i = 0; data && i < data.length; i += SCATTER_STRIDE) expect(data[i + 5]).toBe(0);
      }
    }
  });

  it('carries walked-scale texture that a coarse LOD does not see', () => {
    // A step of ~30 cm on the lightly-cratered world: full detail must
    // vary at centimeter amplitude, while a 100 m sampling of the same
    // spots is blind to it — the fine bands respect the Nyquist gate.
    // (The crater-saturated worlds keep steep walls at every LOD by
    // design, so they cannot separate the band property.)
    // Second differences: smooth mid-band gradients cancel, so only
    // sub-meter content registers — the coarse LOD must carry none.
    const stepRad = 0.3 / earthLike.params.radiusM;
    const coarseLod = 100 / earthLike.params.radiusM;
    let fine = 0;
    let coarse = 0;
    const dirs = sampleDirs(200);
    for (const dir of dirs) {
      const curvature = (lod: number): number => {
        const forward = { x: dir.x + stepRad, y: dir.y, z: dir.z };
        const back = { x: dir.x - stepRad, y: dir.y, z: dir.z };
        const lf = Math.hypot(forward.x, forward.y, forward.z);
        const lb = Math.hypot(back.x, back.y, back.z);
        return Math.abs(
          earthLike.heightAt({ x: forward.x / lf, y: forward.y / lf, z: forward.z / lf }, lod) -
            2 * earthLike.heightAt(dir, lod) +
            earthLike.heightAt({ x: back.x / lb, y: back.y / lb, z: back.z / lb }, lod),
        );
      };
      fine += curvature(0);
      coarse += curvature(coarseLod);
    }
    expect(fine / dirs.length).toBeGreaterThan(0.004);
    expect(coarse / dirs.length).toBeLessThan((fine / dirs.length) * 0.2);
  });
});

describe('chunk meshes', () => {
  const field = world(11n, 'rocky', 1, 1);

  it('is deterministic', () => {
    const a = buildChunkMesh(field, 0, 3, 2, 5, 16);
    const b = buildChunkMesh(field, 0, 3, 2, 5, 16);
    expect(a.positions).toEqual(b.positions);
    expect(a.colors).toEqual(b.colors);
  });

  it('adjacent chunks share identical edge vertices', () => {
    const res = 16;
    const left = buildChunkMesh(field, 0, 4, 3, 6, res);
    const right = buildChunkMesh(field, 0, 4, 4, 6, res);
    for (let j = 0; j <= res; j++) {
      // Right edge of the left chunk vs left edge of the right chunk.
      const li = (j * (res + 1) + res) * 3;
      const ri = (j * (res + 1) + 0) * 3;
      for (let c = 0; c < 3; c++) {
        const worldLeft = left.positions[li + c] + left.centerKm[c];
        const worldRight = right.positions[ri + c] + right.centerKm[c];
        expect(Math.abs(worldLeft - worldRight)).toBeLessThan(2e-3);
      }
    }
  });

  it('height is continuous across cube-face seams', () => {
    // Faces 0 (+X) and 4 (+Z) share the edge x=z>0.
    const a = faceUvToDir(0, 0.001, 0.5);
    const b = faceUvToDir(4, 0.999, 0.5);
    expect(Math.abs(field.heightAt(a) - field.heightAt(b))).toBeLessThan(
      field.params.reliefM * 0.05,
    );
  });

  it('keeps walking-scale crack skirts smaller than their tile', () => {
    const res = 16;
    const mesh = buildChunkMesh(field, 4, 22, 2 ** 21, 2 ** 21, res);
    const skirt = (res + 1) ** 2 * 3;
    const drop = Math.hypot(...[0, 1, 2].map((axis) => mesh.positions[axis] - mesh.positions[skirt + axis]));
    const tileKm = Math.PI / 2 * field.params.radiusM / 1000 / 2 ** 22;
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThan(tileKm * 0.1);
  });

  it('geomorph reproduces every parent triangle, including its edge midpoints', () => {
    const res = 16;
    const parent = buildChunkMesh(field, 2, 8, 65, 130, res);
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const child = buildChunkMesh(field, 2, 9, 130 + cx, 260 + cy, res);
      for (let j = 0; j <= res; j++) {
        for (let i = 0; i <= res; i++) {
          const u = cx * res / 2 + i / 2, v = cy * res / 2 + j / 2;
          const px = Math.min(Math.floor(u), res - 1), py = Math.min(Math.floor(v), res - 1);
          const fu = u - px, fv = v - py;
          const a = py * (res + 1) + px, b = a + 1, c = a + res + 1, d = c + 1;
          const corners = fu + fv <= 1 ? [[a, 1 - fu - fv], [b, fu], [c, fv]] :
            [[b, 1 - fv], [d, fu + fv - 1], [c, 1 - fu]];
          const index = j * (res + 1) + i;
          for (let axis = 0; axis < 3; axis++) {
            const expected = parent.centerKm[axis] + corners.reduce((sum, [k, w]) => sum + parent.positions[k * 3 + axis] * w, 0);
            const actual = child.centerKm[axis] + child.positions[index * 3 + axis] - child.morph[index * 4 + axis];
            expect(Math.abs(actual - expected)).toBeLessThan(2e-6);
          }
        }
      }
    }
  });
});
