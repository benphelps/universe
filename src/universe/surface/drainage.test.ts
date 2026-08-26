import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../core/math/vec3';
import { createCubeGrid } from './cubeGrid';
import { buildDrainage } from './drainage';

/** One smooth continent centered on +X, shores at dot = 0.35, peak 3 km. */
const continent = (dir: Vec3): number => (dir.x - 0.35) * 3000;

describe('cube grid', () => {
  const grid = createCubeGrid(8);

  it('cell centers map back to their own cells', () => {
    for (let cell = 0; cell < grid.cellCount; cell++) {
      expect(grid.cellOfDir(grid.centerOf(cell))).toBe(cell);
    }
  });

  it('every cell has a full neighborhood, across face seams too', () => {
    for (let cell = 0; cell < grid.cellCount; cell++) {
      const neighbors = grid.neighborsOf(cell);
      let count = 0;
      for (let k = 0; k < 8; k++) if (neighbors[k] >= 0) count++;
      expect(count).toBeGreaterThanOrEqual(5);
      for (let k = 0; k < 8; k++) {
        if (neighbors[k] < 0) continue;
        // A neighbor is never farther than ~two cell diagonals away.
        const a = grid.centerOf(cell);
        const b = grid.centerOf(neighbors[k]);
        const chord = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        expect(chord).toBeLessThan(3 * grid.cellAngularRad);
      }
    }
  });
});

describe('drainage graph', () => {
  const graph = buildDrainage(continent, 6.4e6, 0, 0.7, 32);

  it('is deterministic', () => {
    const again = buildDrainage(continent, 6.4e6, 0, 0.7, 32);
    expect(again.flowTo).toEqual(graph.flowTo);
    expect(again.dischargeM3s).toEqual(graph.dischargeM3s);
  });

  it('routes every land cell to the sea without cycles', () => {
    for (let cell = 0; cell < graph.grid.cellCount; cell++) {
      if (graph.ocean[cell]) continue;
      let current = cell;
      let steps = 0;
      while (!graph.ocean[current]) {
        current = graph.flowTo[current];
        expect(current).toBeGreaterThanOrEqual(0);
        expect(steps++).toBeLessThan(graph.grid.cellCount);
      }
    }
  });

  it('discharge grows downstream and spill never rises', () => {
    for (let cell = 0; cell < graph.grid.cellCount; cell++) {
      if (graph.ocean[cell]) continue;
      const downstream = graph.flowTo[cell];
      if (downstream < 0 || graph.ocean[downstream]) continue;
      expect(graph.dischargeM3s[downstream]).toBeGreaterThanOrEqual(graph.dischargeM3s[cell]);
      expect(graph.spillM[downstream]).toBeLessThanOrEqual(graph.spillM[cell] + 1e-6);
      expect(graph.spillM[cell]).toBeGreaterThanOrEqual(graph.heightsM[cell] - 1e-6);
    }
  });

  it('gathers real rivers on a wet continent', () => {
    let rivers = 0;
    let maxQ = 0;
    for (let cell = 0; cell < graph.grid.cellCount; cell++) {
      if (graph.ocean[cell]) continue;
      if (graph.dischargeM3s[cell] >= graph.riverMinM3s) rivers++;
      maxQ = Math.max(maxQ, graph.dischargeM3s[cell]);
    }
    expect(rivers).toBeGreaterThan(20);
    expect(maxQ).toBeGreaterThan(graph.riverMinM3s * 5);
  });

  it('finds a river from a point on its course, none from open ocean', () => {
    let riverCell = -1;
    for (let cell = 0; cell < graph.grid.cellCount; cell++) {
      if (!graph.ocean[cell] && graph.dischargeM3s[cell] >= graph.riverMinM3s && graph.flowTo[cell] >= 0) {
        riverCell = cell;
        break;
      }
    }
    expect(riverCell).toBeGreaterThanOrEqual(0);
    const onCourse = graph.nearestRiver(graph.grid.centerOf(riverCell));
    expect(onCourse).not.toBeNull();
    expect(onCourse!.distRad).toBeLessThan(graph.grid.cellAngularRad * 0.5);
    expect(onCourse!.dischargeM3s).toBeGreaterThanOrEqual(graph.riverMinM3s);
    expect(graph.nearestRiver({ x: -1, y: 0, z: 0 })).toBeNull();
  });
});
