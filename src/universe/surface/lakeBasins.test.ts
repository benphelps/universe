import { describe, expect, it } from 'vitest';
import { createCubeGrid } from './cubeGrid';
import { confineLakeBasins } from './lakeBasins';
import type { Vec3 } from '../../core/math/vec3';

const grid = createCubeGrid(8);
const cells = [3, 4].flatMap(y => [3, 4].map(x => 4 * 64 + y * 8 + x));
function proposedLake() {
  const lakeM = new Float32Array(grid.cellCount).fill(-Infinity);
  for (const cell of cells) lakeM[cell] = 400;
  return { grid, lakeM, seaLevelM: 0 };
}
// Four connected cells enclose a 100 m floor behind a 500 m rim.
function terrain(dir: Vec3) {
  return 100 + 400 * (Math.max(Math.abs(dir.x / dir.z), Math.abs(dir.y / dir.z)) / 0.25) ** 2;
}

describe('fine-terrain lake containment', () => {
  it('keeps a closed multi-cell lake level across its internal edges', () => {
    const lake = proposedLake();
    confineLakeBasins(lake, terrain);
    for (const cell of cells) expect(lake.lakeM[cell]).toBe(400);
  });

  it('lowers the whole lake to a fine outlet missed by the coarse cell centers', () => {
    const lake = proposedLake();
    confineLakeBasins(lake, dir => Math.abs(dir.y / dir.z) < 0.04 && dir.x / dir.z > 0.23 ? 250 : terrain(dir));
    for (const cell of cells) expect(lake.lakeM[cell]).toBe(249);
  });

  it('removes an elevated sheet when the detailed basin opens into the global sea', () => {
    const lake = proposedLake();
    confineLakeBasins(lake, dir => Math.abs(dir.y / dir.z) < 0.04 && dir.x / dir.z > 0.23 ? -10 : terrain(dir));
    for (const cell of cells) expect(lake.lakeM[cell]).toBe(-Infinity);
  });
});
