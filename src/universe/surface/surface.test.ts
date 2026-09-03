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
import { deriveTreeSpecies, TREE_SPECIES_COUNT } from './flora';
import { SCATTER_STRIDE, scatterForChunk } from './scatter';

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
    const dirs = sampleDirs(500);
    for (let i = 0; i < dirs.length - 1 && beachSlopes.length < 15; i++) {
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

  it('grows deterministic tree species, and forests stand in the rain', () => {
    const forestWorld = world(19n, 'rocky', 1, 1);
    expect(forestWorld.params.biosphere).toBe(true);
    const species = deriveTreeSpecies(forestWorld.params);
    expect(species).toEqual(deriveTreeSpecies(forestWorld.params));
    expect(species.length).toBe(TREE_SPECIES_COUNT);
    for (const tree of species) {
      expect(tree.trunkHM).toBeGreaterThan(2);
      expect(tree.trunkHM).toBeLessThan(15);
      for (const c of [...tree.barkColor, ...tree.canopyColor]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    // A rainy temperate lowland cell should scatter trees on its tiles.
    const drainage = forestWorld.drainage!;
    const climate = forestWorld.climate!;
    const n = drainage.grid.n;
    let trees = 0;
    for (let cell = 0; cell < drainage.grid.cellCount && trees === 0; cell++) {
      if (drainage.ocean[cell]) continue;
      if (climate.precipMmYr[cell] < 1100) continue;
      if (climate.tempK[cell] < 272 || climate.tempK[cell] > 308) continue;
      const face = Math.floor(cell / (n * n));
      const rem = cell % (n * n);
      // A mid-cell tile at quadtree level 13 (tile ≈ 870 m — scatter range).
      const x = (rem % n) * 64 + 32;
      const y = Math.floor(rem / n) * 64 + 32;
      const data = scatterForChunk(forestWorld, face, 13, x, y, [0, 0, 0]);
      if (!data) continue;
      for (let i = 0; i < data.length; i += SCATTER_STRIDE) {
        if (Math.round(data[i + 5]) >= 2) trees++;
      }
    }
    expect(trees).toBeGreaterThan(0);
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

  it('geomorph deltas reproduce the parent-LOD surface', () => {
    const res = 16;
    const mesh = buildChunkMesh(field, 2, 9, 130, 260, res);
    const tiles = 2 ** 9;
    const lod = Math.PI / 2 / tiles / res;
    for (let j = 0; j <= res; j += 4) {
      for (let i = 0; i <= res; i += 4) {
        const index = j * (res + 1) + i;
        const world = {
          x: mesh.positions[index * 3] + mesh.centerKm[0],
          y: mesh.positions[index * 3 + 1] + mesh.centerKm[1],
          z: mesh.positions[index * 3 + 2] + mesh.centerKm[2],
        };
        const l = Math.hypot(world.x, world.y, world.z);
        const dir = { x: world.x / l, y: world.y / l, z: world.z / l };
        // Removing the stored delta from the vertex radius lands on the
        // parent-LOD height — the surface a swap must match exactly.
        const morphedM = (l - mesh.morph[index * 2]) * 1000 - field.params.radiusM / 1000 * 1000;
        expect(morphedM).toBeCloseTo(field.heightAt(dir, lod * 2), 0);
        expect(mesh.morph[index * 2 + 1]).toBeCloseTo(
          ((Math.PI / 2) * (field.params.radiusM / 1000)) / tiles,
          6,
        );
      }
    }
  });
});
