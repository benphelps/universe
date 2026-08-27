import type { CubeGrid } from './cubeGrid';

/** Rained-out fraction of carried moisture per cell crossed. */
const BASE_RAIN = 0.055;
/** Extra rain-out per km of forced ascent along the wind. */
const OROGRAPHIC_PER_KM = 0.35;
/** Advection sweeps — enough for moisture to cross a continent. */
const SWEEPS = 70;

/**
 * Climate as a field over the sphere, on the same global grid the
 * drainage uses. Zonal circulation bands (three-cell for fast rotators,
 * one sluggish cell for slow ones) set a wind per cell; oceans
 * evaporate by their local temperature; moisture advects downwind,
 * raining a base fraction per cell and more on forced ascents. What
 * this buys without painting any of it: wet windward coasts, rain
 * shadows behind ranges, continental interiors that dry with fetch,
 * and polar deserts.
 */
export interface ClimateField {
  grid: CubeGrid;
  /** Sea-level-ish air temperature per cell, K. */
  tempK: Float32Array;
  /** Annual precipitation per cell, mm/yr. */
  precipMmYr: Float32Array;
  /** Interpolated precipitation at a direction, mm/yr (9-cell IDW). */
  precipAt(dir: { x: number; y: number; z: number }): number;
}

export function buildClimate(
  grid: CubeGrid,
  cellHeightsM: Float32Array,
  ocean: Uint8Array,
  surfaceMeanK: number,
  poleDeltaK: number,
  lapseKPerKm: number,
  rotationPeriodHours: number,
  wetness: number,
): ClimateField {
  const { cellCount, centers } = grid;
  const threeCell = rotationPeriodHours < 120;

  // Per-cell temperature and the upwind neighbor each cell draws from.
  const tempK = new Float32Array(cellCount);
  const upwind = new Int32Array(cellCount);
  const evapM = new Float32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell++) {
    const x = centers[cell * 3];
    const y = centers[cell * 3 + 1];
    const z = centers[cell * 3 + 2];
    const latitude = Math.asin(Math.max(-1, Math.min(1, y)));
    tempK[cell] =
      surfaceMeanK -
      poleDeltaK * Math.sin(latitude) ** 2 -
      (lapseKPerKm * Math.max(0, cellHeightsM[cell])) / 1000;

    // Surface winds by circulation band: trades, westerlies, polar
    // easterlies — or one sluggish easterly cell on slow rotators.
    const absLat = Math.abs(latitude);
    let east: number;
    let poleward: number;
    if (!threeCell) {
      east = -1;
      poleward = 0.25;
    } else if (absLat < 0.44) {
      east = -1;
      poleward = -0.35;
    } else if (absLat < 1.0) {
      east = 1;
      poleward = 0.3;
    } else {
      east = -0.8;
      poleward = -0.25;
    }
    // Local tangent basis; wind = east·ê + poleward·n̂·sign(lat).
    const horizontal = Math.max(1e-6, Math.hypot(x, z));
    const ex = -z / horizontal;
    const ez = x / horizontal;
    const nx = (-x * y) / horizontal;
    const ny = horizontal;
    const nz = (-z * y) / horizontal;
    const sign = latitude >= 0 ? 1 : -1;
    const wx = east * ex + poleward * sign * nx;
    const wy = poleward * sign * ny;
    const wz = east * ez + poleward * sign * nz;

    // The upwind neighbor: the one the wind blows FROM.
    const neighbors = grid.neighborsOf(cell);
    let best = cell;
    let bestDot = Infinity;
    for (let k = 0; k < 8; k++) {
      const neighbor = neighbors[k];
      if (neighbor < 0) continue;
      const dx = centers[neighbor * 3] - x;
      const dy = centers[neighbor * 3 + 1] - y;
      const dz = centers[neighbor * 3 + 2] - z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dot = (dx * wx + dy * wy + dz * wz) / len;
      if (dot < bestDot) {
        bestDot = dot;
        best = neighbor;
      }
    }
    upwind[cell] = best;

    // Clausius-Clapeyron-flavored evaporation from open water.
    if (ocean[cell]) evapM[cell] = Math.exp((tempK[cell] - 288) / 14);
  }

  // Advect to a fixpoint: each sweep pulls moisture from upwind, rains
  // a base fraction plus the forced-ascent term, and refills over water.
  let moisture = new Float32Array(cellCount);
  let next = new Float32Array(cellCount);
  const rained = new Float32Array(cellCount);
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const last = sweep === SWEEPS - 1;
    for (let cell = 0; cell < cellCount; cell++) {
      const from = upwind[cell];
      const carried = moisture[from];
      const ascentKm =
        Math.max(0, Math.max(0, cellHeightsM[cell]) - Math.max(0, cellHeightsM[from])) / 1000;
      const rainFrac = Math.min(0.85, BASE_RAIN + OROGRAPHIC_PER_KM * ascentKm);
      const rain = carried * rainFrac;
      next[cell] = carried - rain + evapM[cell] * 0.12;
      if (last) rained[cell] = rain;
    }
    const swap = moisture;
    moisture = next;
    next = swap;
  }

  // Normalize the equilibrium rain into mm/yr: full wetness with the
  // mean ocean-cell moisture raining at BASE_RAIN ≈ a temperate 900.
  let oceanMoisture = 0;
  let oceanCells = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    if (ocean[cell]) {
      oceanMoisture += moisture[cell];
      oceanCells++;
    }
  }
  const reference = Math.max(1e-6, (oceanMoisture / Math.max(1, oceanCells)) * BASE_RAIN);
  const precipMmYr = new Float32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell++) {
    precipMmYr[cell] = (rained[cell] / reference) * 900 * wetness;
  }

  return wrapClimate(grid, tempK, precipMmYr);
}

/** A climate field from its finished per-cell arrays — the closure half
 *  of buildClimate, so precomputed arrays (a worker's survey) rebuild
 *  the identical field without the moisture solve. */
export function wrapClimate(
  grid: CubeGrid,
  tempK: Float32Array,
  precipMmYr: Float32Array,
): ClimateField {
  const { centers } = grid;
  const precipAt = (dir: { x: number; y: number; z: number }): number => {
    const home = grid.cellOfDir(dir);
    const around = grid.neighborsOf(home);
    let sum = 0;
    let weight = 0;
    for (let k = -1; k < 8; k++) {
      const cell = k < 0 ? home : around[k];
      if (cell < 0) continue;
      const dx = centers[cell * 3] - dir.x;
      const dy = centers[cell * 3 + 1] - dir.y;
      const dz = centers[cell * 3 + 2] - dir.z;
      const w = 1 / (grid.cellAngularRad * 0.25 + Math.hypot(dx, dy, dz));
      sum += precipMmYr[cell] * w;
      weight += w;
    }
    return sum / Math.max(1e-9, weight);
  };

  return { grid, tempK, precipMmYr, precipAt };
}
