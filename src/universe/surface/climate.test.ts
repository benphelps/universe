import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../core/math/vec3';
import { buildClimate } from './climate';
import { createCubeGrid } from './cubeGrid';

const grid = createCubeGrid(32);

function climateFor(heightFn: (dir: Vec3) => number) {
  const heights = new Float32Array(grid.cellCount);
  const ocean = new Uint8Array(grid.cellCount);
  for (let cell = 0; cell < grid.cellCount; cell++) {
    heights[cell] = heightFn(grid.centerOf(cell));
    if (heights[cell] < 0) ocean[cell] = 1;
  }
  return buildClimate(grid, heights, ocean, 288, 30, 5.5, 24, 0.8);
}

const at = (latRad: number, lonRad: number): Vec3 => ({
  x: Math.cos(latRad) * Math.cos(lonRad),
  y: Math.sin(latRad),
  z: Math.cos(latRad) * Math.sin(lonRad),
});

describe('climate field', () => {
  it('is deterministic', () => {
    const wall = (dir: Vec3): number => (dir.x > 0.5 ? 800 : -500);
    const a = climateFor(wall);
    const b = climateFor(wall);
    expect(a.precipMmYr).toEqual(b.precipMmYr);
  });

  it('a meridional ridge casts a rain shadow in the westerlies', () => {
    // A north-south wall on an ocean world; both flanks sit at the same
    // height, so only the wind direction separates them.
    const ridge = (dir: Vec3): number => {
      const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      const lon = Math.atan2(dir.z, dir.x);
      if (Math.abs(lon) > 0.18 || Math.abs(lat) > 1.2) return -500;
      return 50 + 2600 * Math.exp(-((lon / 0.06) ** 2));
    };
    const climate = climateFor(ridge);
    // Mid-latitude westerlies blow +lon; windward is -lon.
    const windward = climate.precipAt(at(0.7, -0.12));
    const lee = climate.precipAt(at(0.7, 0.12));
    expect(windward).toBeGreaterThan(lee * 2);
    expect(lee).toBeGreaterThan(0);
  });

  it('continental interiors dry with fetch from the sea', () => {
    // A flat half-planet continent: no orography, only distance.
    const halfWorld = (dir: Vec3): number => (dir.x > 0 ? 300 : -500);
    const climate = climateFor(halfWorld);
    // At mid-northern latitude the wind runs eastward: the western
    // coast is upwind, the far interior a third of a world downwind.
    const coast = climate.precipAt(at(0.7, -1.35));
    const interior = climate.precipAt(at(0.7, 0.6));
    expect(coast).toBeGreaterThan(interior * 1.5);
  });
});
