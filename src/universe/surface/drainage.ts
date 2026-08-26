import type { Vec3 } from '../../core/math/vec3';
import { YEAR } from '../../core/physics/constants';
import { createCubeGrid, type CubeGrid } from './cubeGrid';

/** Fraction of rainfall that runs off instead of evaporating. */
const RUNOFF_FRACTION = 0.35;
/** Peak precipitation at full wetness, mm/yr. */
const PRECIP_PEAK_MM_YR = 1100;
/** A cell is river-bearing once it gathers this many cells' runoff. */
const RIVER_CELLS_MIN = 3.5;

/**
 * The planet's water finds its way: flow routing over a global cube-
 * sphere grid. Ocean cells seed a priority-flood, so every land cell
 * acquires a monotone downhill (or spill-over) path to the sea —
 * depressions fill to their spill level, which is where lakes live.
 * Runoff accumulates downstream into mean discharge per cell, and the
 * cell→downstream segments are the river network: one graph feeds the
 * terrain carving, the orbital river traces, and (later) the rendered
 * water. Precipitation is a placeholder latitude curve until the S5
 * climate field replaces it.
 */
export interface DrainageGraph {
  grid: CubeGrid;
  radiusM: number;
  seaLevelM: number;
  /** Cell-center terrain heights (coarse LOD), m above datum. */
  heightsM: Float32Array;
  /** Downstream cell per cell; -1 for ocean cells. */
  flowTo: Int32Array;
  /** Mean discharge routed through each cell, m³/s. */
  dischargeM3s: Float32Array;
  /** Depression fill level, m — above heightsM inside lakes. */
  spillM: Float32Array;
  ocean: Uint8Array;
  /** Discharge above which a cell carries a carving river. */
  riverMinM3s: number;
  /**
   * Distance (radians) from dir to the nearest river segment in the
   * surrounding cells, with that segment's discharge and spill level.
   * Returns null when no river runs nearby. The result object is
   * reused across calls — read it before calling again.
   */
  nearestRiver(dir: Vec3): { distRad: number; dischargeM3s: number; spillM: number } | null;
}

export function buildDrainage(
  heightAt: (dir: Vec3, lodAngularRad?: number) => number,
  radiusM: number,
  seaLevelM: number,
  wetness: number,
  n: number,
): DrainageGraph {
  const grid = createCubeGrid(n);
  const { cellCount, centers } = grid;
  const sampleLod = grid.cellAngularRad / 2;

  const heightsM = new Float32Array(cellCount);
  const ocean = new Uint8Array(cellCount);
  const dir = { x: 0, y: 0, z: 0 };
  let lowest = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    dir.x = centers[cell * 3];
    dir.y = centers[cell * 3 + 1];
    dir.z = centers[cell * 3 + 2];
    const h = heightAt(dir, sampleLod);
    heightsM[cell] = h;
    if (h < heightsM[lowest]) lowest = cell;
    if (h < seaLevelM) ocean[cell] = 1;
  }

  // Priority-flood from the sea (or the deepest basin on a dry world):
  // cells pop in ascending spill order, so each land cell's flowTo
  // points at an already-drained neighbor and the whole surface routes.
  const spillM = new Float32Array(cellCount);
  const flowTo = new Int32Array(cellCount).fill(-1);
  const visited = new Uint8Array(cellCount);
  const heap = new MinHeap(cellCount);
  for (let cell = 0; cell < cellCount; cell++) {
    if (ocean[cell]) {
      spillM[cell] = seaLevelM;
      visited[cell] = 1;
      heap.push(cell, seaLevelM);
    }
  }
  if (heap.size === 0) {
    spillM[lowest] = heightsM[lowest];
    visited[lowest] = 1;
    heap.push(lowest, spillM[lowest]);
  }
  const popOrder = new Int32Array(cellCount);
  let popCount = 0;
  while (heap.size > 0) {
    const cell = heap.pop();
    popOrder[popCount++] = cell;
    const neighbors = grid.neighborsOf(cell);
    for (let k = 0; k < 8; k++) {
      const neighbor = neighbors[k];
      if (neighbor < 0 || visited[neighbor]) continue;
      visited[neighbor] = 1;
      spillM[neighbor] = Math.max(heightsM[neighbor], spillM[cell]);
      flowTo[neighbor] = cell;
      heap.push(neighbor, spillM[neighbor]);
    }
  }

  // Runoff accumulation, upstream cells first (reverse pop order is
  // topological: flowTo always points at an earlier pop).
  const dischargeM3s = new Float32Array(cellCount);
  const cellAreaM2 = (4 * Math.PI * radiusM * radiusM) / cellCount;
  let meanRunoff = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    if (ocean[cell]) continue;
    const latitude = Math.asin(Math.max(-1, Math.min(1, centers[cell * 3 + 1])));
    const precipMYr =
      (PRECIP_PEAK_MM_YR / 1000) * wetness * (0.3 + 0.7 * Math.cos(latitude));
    dischargeM3s[cell] = (cellAreaM2 * precipMYr * RUNOFF_FRACTION) / YEAR;
    meanRunoff += dischargeM3s[cell];
  }
  meanRunoff /= Math.max(1, cellCount - countOnes(ocean));
  for (let p = popCount - 1; p >= 0; p--) {
    const cell = popOrder[p];
    const downstream = flowTo[cell];
    if (downstream >= 0 && !ocean[cell]) dischargeM3s[downstream] += dischargeM3s[cell];
  }
  const riverMinM3s = meanRunoff * RIVER_CELLS_MIN;

  // Zero-allocation nearest-segment query over the 3×3 neighborhood's
  // downstream segments; chord distances stand in for arcs at cell scale.
  const result = { distRad: 0, dischargeM3s: 0, spillM: 0 };
  const nearestRiver = (at: Vec3) => {
    const home = grid.cellOfDir(at);
    const around = grid.neighborsOf(home);
    let best = -1;
    let bestDist = Infinity;
    for (let k = -1; k < 8; k++) {
      const cell = k < 0 ? home : around[k];
      if (cell < 0 || ocean[cell]) continue;
      if (dischargeM3s[cell] < riverMinM3s) continue;
      const downstream = flowTo[cell];
      if (downstream < 0) continue;
      const ax = centers[cell * 3];
      const ay = centers[cell * 3 + 1];
      const az = centers[cell * 3 + 2];
      const bx = centers[downstream * 3] - ax;
      const by = centers[downstream * 3 + 1] - ay;
      const bz = centers[downstream * 3 + 2] - az;
      const px = at.x - ax;
      const py = at.y - ay;
      const pz = at.z - az;
      const segSq = bx * bx + by * by + bz * bz;
      let t = segSq > 0 ? (px * bx + py * by + pz * bz) / segSq : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = px - bx * t;
      const dy = py - by * t;
      const dz = pz - bz * t;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = cell;
      }
    }
    if (best < 0) return null;
    result.distRad = bestDist;
    result.dischargeM3s = dischargeM3s[best];
    result.spillM = spillM[best];
    return result;
  };

  return {
    grid,
    radiusM,
    seaLevelM,
    heightsM,
    flowTo,
    dischargeM3s,
    spillM,
    ocean,
    riverMinM3s,
    nearestRiver,
  };
}

function countOnes(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i];
  return count;
}

/** Binary min-heap over cell ids keyed by spill height. */
class MinHeap {
  size = 0;
  private readonly cells: Int32Array;
  private readonly keys: Float64Array;

  constructor(capacity: number) {
    this.cells = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  push(cell: number, key: number): void {
    let i = this.size++;
    this.cells[i] = cell;
    this.keys[i] = key;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.cells[0];
    this.size--;
    if (this.size > 0) {
      this.cells[0] = this.cells[this.size];
      this.keys[0] = this.keys[this.size];
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.size && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.size && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const cell = this.cells[a];
    this.cells[a] = this.cells[b];
    this.cells[b] = cell;
    const key = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = key;
  }
}
