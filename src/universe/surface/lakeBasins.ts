import type { Vec3 } from '../../core/math/vec3';
import { faceUvToDir } from './cubeSphere';
import type { DrainageGraph } from './drainage';

/** The routing grid proposes pools, but its cell centers cannot establish
 * shorelines. Lower each connected pool to its sampled fine-terrain rim;
 * an opening to the global sea removes the elevated pool altogether.
 * This bounded survey runs once in the terrain worker, never per chunk.
 */
export function confineLakeBasins(graph: Pick<DrainageGraph, 'grid' | 'lakeM' | 'seaLevelM'>, heightAt: (dir: Vec3) => number): void {
  const { grid, lakeM, seaLevelM } = graph;
  const candidates = Uint8Array.from(lakeM, h => Number.isFinite(h) ? 1 : 0);
  const membership = new Uint32Array(grid.cellCount);
  const samples = 8;
  for (let start = 0; start < grid.cellCount; start++) {
    if (!candidates[start] || membership[start]) continue;
    const basin = [start];
    const basinId = start + 1;
    membership[start] = basinId;
    let level = Infinity, floor = Infinity;
    for (let k = 0; k < basin.length; k++) {
      const cell = basin[k];
      level = Math.min(level, lakeM[cell]);
      for (const next of grid.neighborsOf(cell)) {
        if (next < 0 || !candidates[next] || membership[next] || Math.abs(lakeM[next] - lakeM[start]) > 0.5) continue;
        membership[next] = basinId;
        basin.push(next);
      }
    }
    survey: for (const cell of basin) {
      const face = Math.floor(cell / (grid.n * grid.n));
      const x = cell % grid.n, y = Math.floor(cell / grid.n) % grid.n;
      // Include interior samples: the fine terrain can reveal a sea inlet
      // or a crater that the routing grid's single height never saw.
      for (let j = 0; j <= samples; j++) for (let i = 0; i <= samples; i++) {
        const boundary = i === 0 || i === samples || j === 0 || j === samples;
        if (!boundary && (i % 4 !== 0 || j % 4 !== 0)) continue;
        const u = (x + i / samples) / grid.n, v = (y + j / samples) / grid.n;
        const h = heightAt(faceUvToDir(face, u, v));
        floor = Math.min(floor, h);
        if (h <= seaLevelM) { level = seaLevelM; break survey; }
        // Test just across an edge, including cube-face seams. Internal
        // edges of a multi-cell lake are not retaining banks.
        const du = i === 0 ? -1e-7 : i === samples ? 1e-7 : 0;
        const dv = j === 0 ? -1e-7 : j === samples ? 1e-7 : 0;
        if ((du || dv) && membership[grid.cellOfDir(faceUvToDir(face, u + du, v + dv))] !== basinId) {
          level = Math.min(level, h - 1);
        }
      }
    }
    const fill = level > seaLevelM + 1 && level > floor + 1 ? level : -Infinity;
    for (const cell of basin) lakeM[cell] = fill;
  }
}
