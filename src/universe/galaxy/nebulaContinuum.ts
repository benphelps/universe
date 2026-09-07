import { blackbodyLinearRgb } from '../../core/color/blackbody';
import { opticalLuminosityFraction } from '../../core/color/optical';
export { opticalLuminosityFraction } from '../../core/color/optical';
import { DUST_OPACITY_PER_PC, HG_G } from './density';
import { SCATTER_OPACITY_RGB } from './dustScattering';

export interface ContinuumSource {
  positionPc: [number, number, number];
  /** Integrated optical luminosity (380–780 nm), L☉. */
  luminositySolar: number;
  /** Unit-luminance camera hue; this is RGB transfer, not spectroscopy. */
  color: [number, number, number];
}
export function stellarContinuum(positionPc: [number, number, number], luminosity: number, temperature: number): ContinuumSource {
  const color = blackbodyLinearRgb(temperature), y = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  return { positionPc, luminositySolar: luminosity * opticalLuminosityFraction(temperature), color: color.map(v => v / (y || 1)) as [number, number, number] };
}

export const CONTINUUM_SIZE = 24;
export const CONTINUUM_SHADOW_STEPS = 64;
/** RGB irradiance (sqrt encoded) and the radiation's first directional
 * moment in two stacked RGBA slabs. A single normalized HG lobe closes
 * that moment. Crossing beams' higher angular moments and secondary
 * scattering are intentionally unresolved. Half-float payload ≤216 KiB/domain. */
/** Positive half floats suffice for packed irradiance and [0,1] moments.
 * Square-root encoding retains faint light across a wide dynamic range. */
export function continuumHalf(value: number): number {
  if (!(value > 0)) return 0;
  if (value < 2 ** -14) return Math.round(value * 2 ** 24);
  const exponent = Math.floor(Math.log2(value));
  return ((exponent + 15) << 10) + Math.round((value / 2 ** exponent - 1) * 1024);
}
const halfValues = Float32Array.from({ length: 0x3c01 }, (_, value) => value < 1024 ? value * 2 ** -24
  : (1 + (value & 1023) / 1024) * 2 ** ((value >> 10) - 15));
export function continuumFloat(value: number): number { return halfValues[value]; }

export interface NebulaContinuum {
  size: number;
  data: Uint16Array;
  irradianceRef: number;
  sources: number;
  luminositySolar: number;
  encodingRelativeError: number;
}
export interface ContinuumGrid {
  size: number; cellPc: number; boxPc: number; originPc: [number, number, number];
  sources: readonly ContinuumSource[];
}

/** Resolve sources at this field's cell scale. Preserve optical power,
 * power-weighted position and colour; never discard a faint member. */
export function continuumSources(grid: ContinuumGrid): ContinuumSource[] {
  const size = Math.min(CONTINUUM_SIZE, grid.size), cell = 2 * grid.boxPc / size;
  const groups = new Map<string, ContinuumSource>();
  const ordered = [...grid.sources].filter(s => s.luminositySolar > 0).sort((a, b) =>
    a.positionPc[0] - b.positionPc[0] || a.positionPc[1] - b.positionPc[1] || a.positionPc[2] - b.positionPc[2] || a.luminositySolar - b.luminositySolar);
  for (const source of ordered) {
    const key = source.positionPc.map((p, axis) => Math.floor((p - grid.originPc[axis] + grid.boxPc) / cell)).join(',');
    const prior = groups.get(key);
    if (!prior) { groups.set(key, { ...source, positionPc: [...source.positionPc], color: [...source.color] }); continue; }
    const total = prior.luminositySolar + source.luminositySolar, share = source.luminositySolar / total;
    for (let axis = 0; axis < 3; axis++) {
      prior.positionPc[axis] += (source.positionPc[axis] - prior.positionPc[axis]) * share;
      prior.color[axis] += (source.color[axis] - prior.color[axis]) * share;
    }
    prior.luminositySolar = total;
  }
  return [...groups.values()];
}

export function continuumColumn(
  origin: readonly number[], point: readonly number[], boxPc: number, cellPc: number,
  dustAt: (x: number, y: number, z: number) => number,
): number {
  const dx = point[0] - origin[0], dy = point[1] - origin[1], dz = point[2] - origin[2];
  return columnFromDelta(origin[0], origin[1], origin[2], dx, dy, dz, Math.hypot(dx, dy, dz), boxPc, cellPc, dustAt);
}

/** The bake already knows this separation; share it with the shadow
 * march instead of allocating vectors and measuring the same ray twice. */
function columnFromDelta(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, distance: number,
  boxPc: number, cellPc: number, dustAt: (x: number, y: number, z: number) => number,
): number {
  let entry = 0;
  if (Math.abs(ox) > boxPc) entry = Math.max(entry, ((ox < 0 ? -boxPc : boxPc) - ox) / dx);
  if (Math.abs(oy) > boxPc) entry = Math.max(entry, ((oy < 0 ? -boxPc : boxPc) - oy) / dy);
  if (Math.abs(oz) > boxPc) entry = Math.max(entry, ((oz < 0 ? -boxPc : boxPc) - oz) / dz);
  const path = distance * (1 - entry);
  const steps = Math.min(CONTINUUM_SHADOW_STEPS, Math.max(1, Math.ceil(path / (2 * cellPc))));
  let tau = 0;
  for (let step = 0; step < steps; step++) {
    const t = entry + (1 - entry) * (step + 0.5) / steps;
    tau += dustAt(ox + dx * t, oy + dy * t, oz + dz * t) * DUST_OPACITY_PER_PC * path / steps;
    if (tau > 28) break;
  }
  return tau;
}

/** Encode the CPU/GPU field identically. Input slabs: RGB irradiance
 * including the opacity's colour dependence, then its normalized first
 * angular moment. Integration/colour errors are independent of Q. */
export function encodeContinuum(grid: ContinuumGrid, sources: readonly ContinuumSource[], raw: Float32Array): NebulaContinuum {
  const size = Math.min(CONTINUUM_SIZE, grid.size), cells = size ** 3;
  let ref = 1e-30;
  for (let at = 0; at < cells; at++) for (let c = 0; c < 3; c++) ref = Math.max(ref, raw[at * 4 + c]);
  const data = new Uint16Array(cells * 8);
  let total = 0, error = 0;
  for (let at = 0; at < cells; at++) for (let c = 0; c < 3; c++) {
    const intensity = raw[at * 4 + c];
    data[at * 4 + c] = continuumHalf(Math.sqrt(Math.max(0, intensity) / ref));
    total += intensity; error += Math.abs(continuumFloat(data[at * 4 + c]) ** 2 * ref - intensity);
    data[(cells + at) * 4 + c] = continuumHalf(0.5 * (1 + Math.max(-1, Math.min(1, raw[(cells + at) * 4 + c]))));
  }
  return { size, data, irradianceRef: ref, sources: sources.length,
    luminositySolar: sources.reduce((sum, s) => sum + s.luminositySolar, 0), encodingRelativeError: error / (total || 1) };
}

export function bakeContinuum(grid: ContinuumGrid, dustAt: (x: number, y: number, z: number) => number): NebulaContinuum {
  const size = Math.min(CONTINUUM_SIZE, grid.size), cell = 2 * grid.boxPc / size, sources = continuumSources(grid);
  const raw = new Float32Array(size ** 3 * 8), offset = size ** 3 * 4;
  // A source is unresolved inside its field cell, not spread over the
  // entire association. Softening shrinks when the field is refined.
  const floor = (0.5 * cell) ** 2;
  const origins = sources.map(source => source.positionPc.map((v, axis) => v - grid.originPc[axis]));
  for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const at = ((k * size + j) * size + i) * 4;
    const px = -grid.boxPc + (i + 0.5) * cell, py = -grid.boxPc + (j + 0.5) * cell, pz = -grid.boxPc + (k + 0.5) * cell;
    let mx = 0, my = 0, mz = 0, weight = 0;
    for (let s = 0; s < sources.length; s++) {
      const source = sources[s], origin = origins[s];
      const dx = px - origin[0], dy = py - origin[1], dz = pz - origin[2], r = Math.hypot(dx, dy, dz);
      const tau = columnFromDelta(origin[0], origin[1], origin[2], dx, dy, dz, r, grid.boxPc, grid.cellPc, dustAt);
      const flux = source.luminositySolar / Math.max(floor, r * r);
      let y = 0;
      for (let c = 0; c < 3; c++) {
        const value = flux * source.color[c] * SCATTER_OPACITY_RGB[c] * Math.exp(-tau * SCATTER_OPACITY_RGB[c]);
        raw[at + c] += value; y += value * [0.2126, 0.7152, 0.0722][c];
      }
      weight += y;
      if (r > 0) { mx += y * dx / r; my += y * dy / r; mz += y * dz / r; }
    }
    if (weight > 0) { raw[offset + at] = mx / weight; raw[offset + at + 1] = my / weight; raw[offset + at + 2] = mz / weight; }
  }
  return encodeContinuum(grid, sources, raw);
}

/** Trilinear reconstruction of the two packed slabs. Direction is the
 * view ray toward the cloud, so outgoing scattered light is -view. */
export function sampleContinuum(field: NebulaContinuum, uvw: readonly number[], out: Float64Array, view?: readonly number[]): void {
  const size = field.size;
  const gx = Math.max(0, Math.min(size - 1, uvw[0] * size - 0.5));
  const gy = Math.max(0, Math.min(size - 1, uvw[1] * size - 0.5));
  const gz = Math.max(0, Math.min(size - 1, uvw[2] * size - 0.5));
  const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
  const fx = gx - ix, fy = gy - iy, fz = gz - iz;
  const momentOffset = size ** 3 * 4;
  let r = 0, green = 0, b = 0, mx = 0, my = 0, mz = 0;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const at = ((Math.min(size - 1, iz + k) * size + Math.min(size - 1, iy + j)) * size + Math.min(size - 1, ix + i)) * 4;
    const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy) * (k ? fz : 1 - fz);
    r += continuumFloat(field.data[at]) * w; green += continuumFloat(field.data[at + 1]) * w; b += continuumFloat(field.data[at + 2]) * w;
    if (view) {
      mx += continuumFloat(field.data[momentOffset + at]) * w; my += continuumFloat(field.data[momentOffset + at + 1]) * w; mz += continuumFloat(field.data[momentOffset + at + 2]) * w;
    }
  }
  let phase = 1;
  if (view) {
    mx = 2 * mx - 1; my = 2 * my - 1; mz = 2 * mz - 1;
    const norm = Math.hypot(mx, my, mz), g = HG_G * Math.min(1, norm);
    const mu = norm > 1e-6 ? -(mx * view[0] + my * view[1] + mz * view[2]) / norm : 0;
    phase = (1 - g * g) / (1 + g * g - 2 * g * mu) ** 1.5;
  }
  out[0] = r * r * field.irradianceRef * phase;
  out[1] = green * green * field.irradianceRef * phase;
  out[2] = b * b * field.irradianceRef * phase;
}

/** One sampler carries both domains, with two slabs apiece. */
export function packContinuumPair(coarse?: NebulaContinuum, fine?: NebulaContinuum): { size: number; data: Uint16Array } {
  const size = coarse?.size ?? 1;
  if (fine && fine.size !== size) throw new Error('continuum pair resolutions must match');
  const data = new Uint16Array(size ** 3 * 16);
  if (coarse) data.set(coarse.data);
  if (fine) data.set(fine.data, size ** 3 * 8);
  return { size, data };
}
