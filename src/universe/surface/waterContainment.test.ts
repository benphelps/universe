import { beforeAll, describe, expect, it } from 'vitest';
import { generateSystem } from '../system/generate';
import { buildSeasonalCycle, seasonalClimateInput } from '../planet/seasonalClimate';
import { buildAnnualMeanField } from '../planet/annualMean';
import { createSurfaceField, surveyOf, type SurfaceField } from './field';

// Reported Dakiax LMFL b: a coarse lake at 1305.8 m lay on top of the
// 466.5 m global sea, with a cliff at the boundary of its survey cells.
const points = [
  { x: -0.7863542191159303, y: -0.40911, z: 0.46289961112381084 },
  { x: -0.778914848447766, y: -0.41377, z: 0.4712600619271631 },
  { x: -0.6588043296400606, y: -0.51383, z: 0.5495048556177737 },
];
let field: SurfaceField, installed: SurfaceField;
beforeAll(() => {
  const planet = generateSystem(0xd0680ebb357124f1n,
    { xPc: 10348.0392, yPc: -5548.3070, zPc: 83.0558 }).planets[0];
  const input = seasonalClimateInput(planet.physical);
  if (typeof input === 'string') throw Error(input);
  const cycle = buildSeasonalCycle(input);
  if (cycle.status !== 'ready') throw Error(cycle.reason);
  const mean = buildAnnualMeanField(cycle.cycle);
  const annualMean = mean.status === 'ready' ? mean.field : undefined;
  field = createSurfaceField(planet.physical.seedHex, planet.physical, { annualMean });
  installed = createSurfaceField(planet.physical.seedHex, planet.physical, { annualMean, deferGrid: true });
  installed.finishGrid!(surveyOf(field)!);
});

describe('reported floating-water regression', () => {
  it('has one ocean level at the formerly elevated patches at every active water LOD', () => {
    expect(field.seaLevelM).toBeCloseTo(466.483, 2);
    for (const dir of points) for (const lod of [0, 1e-6, 1e-4, 0.005]) {
      if (lod === 0) expect(field.heightAt(dir)).toBeLessThan(field.seaLevelM);
      expect(field.waterLevelAt(dir, lod)).toBe(field.seaLevelM);
      expect(installed.waterLevelAt(dir, lod)).toBe(field.seaLevelM);
    }
    // The fix retains validated inland basins rather than removing lakes.
    expect(field.drainage!.lakeM.filter(h => h > field.seaLevelM).length).toBeGreaterThan(10);
  });

  it('keeps cached mesh heights and standalone camera queries consistent', () => {
    for (let i = 0; i < 2000; i++) {
      const y = 1 - 2 * (i + 0.5) / 2000, r = Math.sqrt(1 - y * y), phi = i * 2.399963229728653;
      const dir = { x: r * Math.cos(phi), y, z: r * Math.sin(phi) };
      const lod = 1e-5, h = field.heightAt(dir, lod), water = field.waterLevelAt(dir, lod, h);
      expect(field.waterLevelAt(dir, lod)).toBe(water);
      expect(installed.waterLevelAt(dir, lod)).toBe(water);
      if (h <= field.seaLevelM) expect(water).toBe(field.seaLevelM);
    }
  });

  it('retains shallow river water without floating sheets outside surveyed lakes', () => {
    const graph = field.drainage!;
    let maximumDepth = 0, wetChannels = 0;
    for (const q of graph.dischargeM3s) maximumDepth = Math.max(maximumDepth, 0.27 * q ** 0.3);
    for (let cell = 0; cell < graph.grid.cellCount; cell += 7) {
      if (graph.ocean[cell] || graph.dischargeM3s[cell] < graph.riverMinM3s) continue;
      const dir = graph.grid.centerOf(cell);
      if (graph.lakeLevelAt(dir) > field.seaLevelM) continue;
      const h = field.heightAt(dir), water = field.waterLevelAt(dir, 0, h);
      if (h > field.seaLevelM && water > h) {
        wetChannels++;
        expect(water - h).toBeLessThanOrEqual(maximumDepth + 1e-6);
      }
    }
    expect(wetChannels).toBeGreaterThan(0);
  });

});
