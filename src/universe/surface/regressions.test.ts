import { describe, expect, it } from 'vitest';
import { AU, G, SOLAR_MASS } from '../../core/physics/constants';
import { mu } from '../../core/physics/units';
import { generateStar } from '../star/generate';
import { characterizePlanet } from '../planet/characterize';
import { computeZones } from '../system/zones';
import { createCraterField } from './craters';
import { createSurfaceField } from './field';
import { deriveSurfaceParams } from './params';
import { createAsteroidField } from './asteroidField';
import { SCATTER_STRIDE, scatterForChunk, scatterLevel } from './scatter';
import type { Asteroid } from '../smallbody/types';

const star = generateStar(1n, { massInitial: 1, ageGyr: 4.6, feH: 0, withCompanions: false });
const elements = { semiMajorAxis: AU, eccentricity: 0, inclination: 0, longitudeOfAscendingNode: 0,
  argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0 };
const physical = characterizePlanet(21n, 'rocky', 0.012, elements, {
  star, centralLuminosity: star.luminosity, mu: mu(G * SOLAR_MASS),
  zones: computeZones(star.luminosity, star.tEff, star.ageGyr, 1),
});

function directions(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), phi = i * 2.399963229728653;
    return { x: r * Math.cos(phi), y, z: r * Math.sin(phi) };
  });
}

describe('surface visual regressions', () => {
  it('does not paint cold dry rock with water ice', () => {
    const dry = createSurfaceField('0000000000000015', {
      ...physical, climate: { ...physical.climate, hydrosphere: 'none', oceanCoverage: 0, surfaceMeanK: 150 },
    });
    const icy = createSurfaceField('0000000000000015', {
      ...physical, climate: { ...physical.climate, hydrosphere: 'ice-sheet', oceanCoverage: 0, surfaceMeanK: 150 },
    });
    for (const dir of directions(50)) {
      const bare = dry.colorAt(dir, 0, 1), frozen = icy.colorAt(dir, 0, 1);
      expect(Math.max(...bare)).toBeLessThan(0.65);
      expect(Math.min(...frozen)).toBeGreaterThan(0.65);
    }
  });

  it('resurfaces volcanic moons instead of saturating them with craters', () => {
    const active = deriveSurfaceParams('0000000000000015', {
      ...physical, interior: { ...physical.interior, regime: 'volcanic' },
    });
    expect(active.tectonics).toBe('stagnant');
    expect(active.volcanism).toBeGreaterThan(0.5);
    expect(active.craterAmplitude).toBeLessThan(0.03);
  });

  it('keeps crater heights continuous when a lookup neighborhood changes', () => {
    const radius = 6_371_000;
    for (const seed of ['0000000000000015', '0123456789abcdef']) {
      const craters = createCraterField(seed, radius, 1);
      for (const size of [0.45, 0.11]) {
        for (let k = -Math.floor(1 / size); k <= Math.floor(1 / size); k++) {
          const x = k * size;
          if (Math.abs(x) >= 0.99) continue;
          for (let j = 0; j < 48; j++) {
            const phi = j * 2 * Math.PI / 48;
            const at = (dx: number) => {
              const r = Math.sqrt(1 - (x + dx) ** 2);
              return { x: x + dx, y: r * Math.cos(phi), z: r * Math.sin(phi) };
            };
            expect(Math.abs(craters(at(1e-9)) - craters(at(-1e-9)))).toBeLessThan(0.1);
          }
        }
      }
    }
  });

  it('has no height jump at the macro or walking-scale warp LOD thresholds', () => {
    const field = createSurfaceField('0000000000000015', physical);
    for (const lod of [0.011, 2.5e-6]) {
      for (const dir of directions(80)) {
        expect(Math.abs(field.heightAt(dir, lod * (1 - 1e-8)) - field.heightAt(dir, lod * (1 + 1e-8)))).toBeLessThan(0.001);
      }
    }
  });

  it('keeps all asteroid taxonomies finite and their fine regolith at modest slopes', () => {
    for (const taxonomy of ['C', 'S', 'M', 'D'] as const) {
      const asteroid: Asteroid = {
        elements, diameterKm: 0.8, taxonomy, albedo: 0.1, spinPeriodHours: 5,
        tumbling: false, rubblePile: true,
        shape: { elongation: 0.65, flattening: 0.7, contactBinary: true, noiseSeedHex: '0123456789abcdef' },
      };
      const field = createAsteroidField(asteroid);
      const slopes: number[] = [];
      const step = 0.1 / field.params.radiusM;
      for (const dir of directions(200)) {
        const near = { x: dir.x + step, y: dir.y, z: dir.z };
        const l = Math.hypot(near.x, near.y, near.z);
        near.x /= l; near.y /= l; near.z /= l;
        const rough = (d: typeof dir) => field.heightAt(d) - field.heightAt(d, 0.001);
        slopes.push(Math.abs(rough(near) - rough(dir)) / 0.1);
        expect(field.params.radiusM + field.heightAt(dir)).toBeGreaterThan(0);
        for (const c of field.colorAt(dir, field.heightAt(dir), 0.9)) expect(c).toBeGreaterThan(0);
      }
      slopes.sort((a, b) => a - b);
      expect(slopes[100]).toBeLessThan(0.4);
      const level = scatterLevel(field.params.radiusM);
      let instances = 0;
      for (let x = 0; x < 2 ** level; x++) {
        const data = scatterForChunk(field, 4, level, x, 1, [0, 0, 0]);
        for (let i = 0; data && i < data.length; i += SCATTER_STRIDE) {
          instances++;
          expect(data[i + 5]).toBe(0);
          expect(data[i + 3] * 1000).toBeLessThanOrEqual(Math.min(5, field.params.radiusM * 0.015));
          const n = data.slice(i + 9, i + 12);
          expect(Math.hypot(...n)).toBeCloseTo(1, 5);
        }
      }
      expect(instances).toBeGreaterThan(0);
    }
  });
});
