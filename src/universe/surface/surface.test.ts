import { mu } from '../../core/physics/units';
import { describe, expect, it } from 'vitest';
import { generateStar } from '../star/generate';
import { characterizePlanet, type CharacterizeContext } from '../planet/characterize';
import { computeZones } from '../system/zones';
import { G, SOLAR_MASS, AU } from '../../core/physics/constants';
import type { PlanetClass } from '../system/types';
import { buildChunkMesh } from './chunkMesh';
import { faceUvToDir } from './cubeSphere';
import { createSurfaceField } from './field';

const SUN = generateStar(1n, { massInitial: 1, ageGyr: 4.6, feH: 0, withCompanions: false });
const CONTEXT: CharacterizeContext = {
  star: SUN,
  centralLuminosity: SUN.luminosity,
  mu: mu(G * SOLAR_MASS),
  zones: computeZones(SUN.luminosity, SUN.tEff, SUN.ageGyr, 1),
};

function world(seed: bigint, planetClass: PlanetClass, massEarth: number, aAu: number) {
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
  return createSurfaceField(seed.toString(16).padStart(16, '0'), physical);
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

  it('is deterministic', () => {
    const again = world(11n, 'rocky', 1, 1);
    for (const dir of sampleDirs(50)) {
      expect(again.heightAt(dir)).toBe(earthLike.heightAt(dir));
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
    const stepRad = 40 / earthLike.params.radiusM;
    const slopeAt = (dir: { x: number; y: number; z: number }): number => {
      const east = norm({ x: -dir.z, y: 0, z: dir.x });
      const a = earthLike.heightAt(norm({
        x: dir.x + east.x * stepRad, y: dir.y, z: dir.z + east.z * stepRad,
      }));
      return Math.abs(a - earthLike.heightAt(dir)) / 40;
    };
    // Bisect dry/wet sample pairs down to the waterline.
    let beach = 0;
    let upland = 0;
    let shores = 0;
    const dirs = sampleDirs(500);
    for (let i = 0; i < dirs.length - 1 && shores < 15; i++) {
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
      beach += slopeAt(dry);
      // Control band: the same coast, 25 m of elevation higher — walk
      // uphill by resampling a short ray toward the dry sample.
      const inland = norm({
        x: dry.x + (dirs[i].x - dry.x) * 0.02,
        y: dry.y + (dirs[i].y - dry.y) * 0.02,
        z: dry.z + (dirs[i].z - dry.z) * 0.02,
      });
      upland += slopeAt(inland);
      shores++;
    }
    expect(shores).toBeGreaterThan(5);
    expect(beach).toBeLessThan(upland * 0.7);
  });

  it('carries walked-scale texture that a coarse LOD does not see', () => {
    // A step of ~30 cm on the airless world: full detail must vary at
    // centimeter amplitude, while a 100 m sampling of the same spots
    // is blind to it — the fine bands respect the Nyquist gate.
    const stepRad = 0.3 / moonLike.params.radiusM;
    const coarseLod = 100 / moonLike.params.radiusM;
    let fine = 0;
    let coarse = 0;
    const dirs = sampleDirs(200);
    for (const dir of dirs) {
      const near = { x: dir.x + stepRad, y: dir.y, z: dir.z };
      const l = Math.hypot(near.x, near.y, near.z);
      const nearDir = { x: near.x / l, y: near.y / l, z: near.z / l };
      fine += Math.abs(moonLike.heightAt(dir) - moonLike.heightAt(nearDir));
      coarse += Math.abs(moonLike.heightAt(dir, coarseLod) - moonLike.heightAt(nearDir, coarseLod));
    }
    expect(fine / dirs.length).toBeGreaterThan(0.005);
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
