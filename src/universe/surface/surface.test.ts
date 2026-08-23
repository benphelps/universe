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
  mu: G * SOLAR_MASS,
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
});
