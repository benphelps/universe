/** Conservative quadrature of a prescribed material map. This is a
 * kinematic remap, not a momentum/energy evolution or an Euler solver. */
export interface GasGrid {
  size: number;
  cellPc: number;
  originPc: [number, number, number];
  hydrogen: Float32Array;
  /** Whole coarse cells replaced by a nested grid. */
  exclusion?: { minimum: [number, number, number]; span: number };
}

export interface GasRemapLedger {
  /** Density-volume units: cm⁻³ pc³. Multiplication by the mass per H
   * converts all entries to mass using the same factor. */
  natal: number;
  incoming: number;
  retained: number;
  outgoing: number;
  relativeResidual: number;
}

export interface MaterialMap {
  /** Write the material's final position into result. */
  move(x: number, y: number, z: number, result: Float64Array): void;
  /** Quadrature subdivisions per donor-cell axis; 0 means unchanged. */
  subdivisions(x: number, y: number, z: number, cellPc: number): number;
}

function excluded(grid: GasGrid, i: number, j: number, k: number): boolean {
  const e = grid.exclusion;
  return !!e && i >= e.minimum[0] && i < e.minimum[0] + e.span
    && j >= e.minimum[1] && j < e.minimum[1] + e.span
    && k >= e.minimum[2] && k < e.minimum[2] + e.span;
}

/** Deposit a packet on adjacent cell centres. Clamp the interpolation
 * kernel at a physical boundary, but reject a packet whose position
 * actually crossed it. At a refinement interface use only uncovered
 * cells, preserving every packet's weight. */
export function depositGas(target: Float64Array, grid: GasGrid, x: number, y: number, z: number, mass: number): boolean {
  const { size, cellPc, originPc } = grid;
  const half = size * cellPc / 2;
  const gx = (x - originPc[0] + half) / cellPc;
  const gy = (y - originPc[1] + half) / cellPc;
  const gz = (z - originPc[2] + half) / cellPc;
  if (gx < 0 || gx > size || gy < 0 || gy > size || gz < 0 || gz > size) return false;
  const px = Math.min(size - 1, Math.max(0, gx - 0.5));
  const py = Math.min(size - 1, Math.max(0, gy - 0.5));
  const pz = Math.min(size - 1, Math.max(0, gz - 0.5));
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  let weight = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const i = Math.min(size - 1, ix + dx), j = Math.min(size - 1, iy + dy), k = Math.min(size - 1, iz + dz);
    if (!excluded(grid, i, j, k)) weight += (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
  }
  if (weight === 0) return false;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const i = Math.min(size - 1, ix + dx), j = Math.min(size - 1, iy + dy), k = Math.min(size - 1, iz + dz);
    if (!excluded(grid, i, j, k)) target[(k * size + j) * size + i] += mass / weight
      * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
  }
  return true;
}

/** Donor-cell mass is divided among quadrature packets, moved, then
 * deposited. No density multiplier or global correction enters this
 * accounting. Output overwrites hydrogen only after all donors are
 * read; an incoming coarse array can double as output working storage. */
export function remapGas(grid: GasGrid, map: MaterialMap, options: {
  incoming?: Float64Array;
  onOutgoing?: (x: number, y: number, z: number, mass: number) => void;
} = {}): GasRemapLedger {
  const { size, cellPc, originPc, hydrogen } = grid;
  const target = options.incoming ?? new Float64Array(size ** 3);
  if (target.length !== size ** 3) throw new Error('invalid gas transfer size');
  let incoming = 0;
  if (options.incoming) for (const mass of target) incoming += mass;
  let natal = 0, outgoing = 0, retained = 0;
  const cellVolume = cellPc ** 3;
  const half = size * cellPc / 2;
  const moved = new Float64Array(3);
  for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    if (excluded(grid, i, j, k)) continue;
    const at = (k * size + j) * size + i;
    const mass = hydrogen[at] * cellVolume;
    if (mass === 0) continue;
    natal += mass;
    const x = originPc[0] - half + (i + 0.5) * cellPc;
    const y = originPc[1] - half + (j + 0.5) * cellPc;
    const z = originPc[2] - half + (k + 0.5) * cellPc;
    const count = map.subdivisions(x, y, z, cellPc);
    if (count === 0) { target[at] += mass; continue; }
    if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error('invalid gas quadrature');
    const packet = mass / count ** 3;
    for (let c = 0; c < count; c++) for (let b = 0; b < count; b++) for (let a = 0; a < count; a++) {
      const px = x + ((a + 0.5) / count - 0.5) * cellPc;
      const py = y + ((b + 0.5) / count - 0.5) * cellPc;
      const pz = z + ((c + 0.5) / count - 0.5) * cellPc;
      map.move(px, py, pz, moved);
      if (moved[0] === px && moved[1] === py && moved[2] === pz) { target[at] += packet; continue; }
      if (!depositGas(target, grid, moved[0], moved[1], moved[2], packet)) {
        outgoing += packet;
        options.onOutgoing?.(moved[0], moved[1], moved[2], packet);
      }
    }
  }
  for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const at = (k * size + j) * size + i;
    if (excluded(grid, i, j, k)) continue;
    hydrogen[at] = target[at] / cellVolume;
    retained += hydrogen[at] * cellVolume;
  }
  return { natal, incoming, retained, outgoing,
    relativeResidual: (natal + incoming - retained - outgoing) / (natal + incoming || 1) };
}

/** Monotone radial map for a uniform depleted interior and a shell of
 * finite width. The natal radius feeding the interior is R f^(1/3),
 * not R / growth: with f=(Rs/R)^(3/2) this gives the ionized mass
 * scaling M_i ∝ Rs^(3/2) R^(3/2) (Bisbas et al. 2015, eqs. 6–7).
 * Swept material supplies the shell through the volume Jacobian. */
export function shellMapRadius(r: number, radius: number, outer: number, fraction: number): number {
  if (radius <= 0 || r >= outer || fraction >= 1) return r;
  if (!(outer > radius) || !(fraction > 0)) throw new Error('invalid shell map');
  const inner = radius * Math.cbrt(fraction);
  if (r < inner) return r / Math.cbrt(fraction);
  return Math.cbrt(radius ** 3 + (r ** 3 - inner ** 3) * (outer ** 3 - radius ** 3) / (outer ** 3 - inner ** 3));
}

/** Inverse radius and density Jacobian, useful for analytic references. */
export function inverseShellMap(r: number, radius: number, outer: number, fraction: number): { radius: number; densityScale: number } {
  if (radius <= 0 || r >= outer || fraction >= 1) return { radius: r, densityScale: 1 };
  if (!(outer > radius) || !(fraction > 0)) throw new Error('invalid shell map');
  if (r < radius) return { radius: r * Math.cbrt(fraction), densityScale: fraction };
  const scale = (outer ** 3 - radius ** 3 * fraction) / (outer ** 3 - radius ** 3);
  return { radius: Math.cbrt(radius ** 3 * fraction + (r ** 3 - radius ** 3) * scale), densityScale: scale };
}
