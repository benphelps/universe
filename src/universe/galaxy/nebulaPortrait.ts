import { sampleContinuum } from './nebulaContinuum';
import type { Nebula } from './nebula';
import { bakeNebulaPair, type NebulaVolumePair } from './nebulaPair';
import { SCATTER_EMISSIVITY_PER_LSUN, type NebulaVolumeBake } from './nebulaVolume';

export interface NebulaPortrait extends NebulaVolumePair {
  luminosities: { lines: number; scattered: number };
  reflectionHue: [number, number, number];
  refinement?: { sizes: number[]; relativeChange: number; converged: boolean };
}

/** Selected objects only; retained encoded payload is bounded per worker. */
export class NebulaPortraitCache {
  private readonly entries = new Map<Nebula, NebulaPortrait>();
  private heldBytes = 0;
  constructor(readonly budgetBytes = 12 << 20) {}
  get bytes(): number { return this.heldBytes; }
  get(nebula: Nebula): NebulaPortrait | undefined {
    const value = this.entries.get(nebula);
    if (value) { this.entries.delete(nebula); this.entries.set(nebula, value); }
    return value;
  }
  put(nebula: Nebula, value: NebulaPortrait): void {
    const bytes = (p: NebulaPortrait) => p.coarse.data.byteLength + p.coarse.occupancy.byteLength + (p.coarse.continuum?.data.byteLength ?? 0)
      + (p.fine ? p.fine.data.byteLength + p.fine.occupancy.byteLength + (p.fine.continuum?.data.byteLength ?? 0) : 0);
    const prior = this.entries.get(nebula);
    if (prior) { this.entries.delete(nebula); this.heldBytes -= bytes(prior); }
    const cost = bytes(value);
    if (cost > this.budgetBytes) return;
    for (const [key, old] of this.entries) {
      if (this.heldBytes + cost <= this.budgetBytes) break;
      this.entries.delete(key); this.heldBytes -= bytes(old);
    }
    this.entries.set(nebula, value); this.heldBytes += cost;
  }
}

const cache = new NebulaPortraitCache();

export function insideNebulaBake(bake: NebulaVolumeBake, x: number, y: number, z: number): boolean {
  return Math.abs(x - bake.originPc[0]) <= bake.halfExtentsPc[0]
    && Math.abs(y - bake.originPc[1]) <= bake.halfExtentsPc[1]
    && Math.abs(z - bake.originPc[2]) <= bake.halfExtentsPc[2];
}

/** Linear texture reconstruction and the near renderer's decoding.
 * Output: dust, line emissivity, continuum emissivity, hardness.
 * Positions are in the cloud frame. */
export function sampleNebulaPortrait(bake: NebulaVolumeBake, x: number, y: number, z: number, out: Float64Array, view?: readonly number[]): void {
  out.fill(0);
  if (!insideNebulaBake(bake, x, y, z)) return;
  const size = bake.size, edge = 2 * bake.halfExtentsPc[0] / size;
  const gx = Math.max(0, Math.min(size - 1, (x - bake.originPc[0] + bake.halfExtentsPc[0]) / edge - 0.5));
  const gy = Math.max(0, Math.min(size - 1, (y - bake.originPc[1] + bake.halfExtentsPc[1]) / edge - 0.5));
  const gz = Math.max(0, Math.min(size - 1, (z - bake.originPc[2] + bake.halfExtentsPc[2]) / edge - 0.5));
  const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
  const fx = gx - ix, fy = gy - iy, fz = gz - iz;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const at = ((Math.min(size - 1, iz + k) * size + Math.min(size - 1, iy + j)) * size + Math.min(size - 1, ix + i)) * 4;
    const weight = (i ? fx : 1 - fx) * (j ? fy : 1 - fy) * (k ? fz : 1 - fz) / 255;
    for (let c = 0; c < 4; c++) out[c] += bake.data[at + c] * weight;
  }
  const dust = out[0] ** 2 * bake.dustRef, measure = ((256 * out[1] + out[3]) / 257 * bake.densityRef) ** 2;
  const hardness = out[2];
  out[0] = dust; out[1] = measure * (bake.emissionCoefficient + (bake.emissionHotCoefficient - bake.emissionCoefficient) * hardness);
  out[2] = 0;
  if (bake.continuum && dust > 0) {
    const a = out[0], line = out[1];
    sampleContinuum(bake.continuum, [(x - bake.originPc[0]) / (2 * bake.halfExtentsPc[0]) + 0.5,
      (y - bake.originPc[1]) / (2 * bake.halfExtentsPc[1]) + 0.5, (z - bake.originPc[2]) / (2 * bake.halfExtentsPc[2]) + 0.5], out, view);
    const intensity = out[0] * 0.2126 + out[1] * 0.7152 + out[2] * 0.0722;
    out[0] = a; out[1] = line; out[2] = intensity * dust * SCATTER_EMISSIVITY_PER_LSUN;
  }
  out[3] = hardness;
}

export function measureNebulaPortrait(pair: NebulaVolumePair, view?: readonly number[]): NebulaPortrait {
  let lines = 0, scattered = 0, red = 0, green = 0, blue = 0;
  const value = new Float64Array(3);
  for (const bake of [pair.coarse, pair.fine]) {
    if (!bake) continue;
    const edge = 2 * bake.halfExtentsPc[0] / bake.size, volume = edge ** 3 * 4 * Math.PI;
    for (let k = 0; k < bake.size; k++) for (let j = 0; j < bake.size; j++) for (let i = 0; i < bake.size; i++) {
      const x = bake.originPc[0] - bake.halfExtentsPc[0] + (i + 0.5) * edge;
      const y = bake.originPc[1] - bake.halfExtentsPc[1] + (j + 0.5) * edge;
      const z = bake.originPc[2] - bake.halfExtentsPc[2] + (k + 0.5) * edge;
      if (bake === pair.coarse && pair.fine && insideNebulaBake(pair.fine, x, y, z)) continue;
      // These are texel centres: read directly rather than reconstruct
      // eight identical neighbours, including millions of empty cells.
      const at = ((k * bake.size + j) * bake.size + i) * 4;
      const dust = (bake.data[at] / 255) ** 2 * bake.dustRef;
      lines += ((bake.data[at + 1] * 256 + bake.data[at + 3]) / 65535 * bake.densityRef) ** 2
        * (bake.emissionCoefficient + (bake.emissionHotCoefficient - bake.emissionCoefficient) * bake.data[at + 2] / 255) * volume;
      if (dust <= 0) continue;
      if (bake.continuum) {
        sampleContinuum(bake.continuum, [(i + 0.5) / bake.size, (j + 0.5) / bake.size, (k + 0.5) / bake.size], value, view);
        const scale = dust * SCATTER_EMISSIVITY_PER_LSUN * volume;
        red += value[0] * scale; green += value[1] * scale; blue += value[2] * scale;
        scattered += (value[0] * 0.2126 + value[1] * 0.7152 + value[2] * 0.0722) * scale;
      }
    }
  }
  return { ...pair, luminosities: { lines, scattered }, reflectionHue: scattered > 0 ? [red / scattered, green / scattered, blue / scattered] : [0, 0, 0] };
}

/** Tiny photometry survives encoded-payload eviction. Otherwise the sky
 * atlas pass would evict its first portraits and its finishing pass
 * would immediately re-bake them. One direction is retained per object. */
type Photometry = Pick<NebulaPortrait, 'luminosities' | 'reflectionHue' | 'refinement'>;
const photometry = new WeakMap<Nebula, { base: Photometry; direction?: string; directed?: Photometry }>();
export function nebulaPortraitPhotometry(nebula: Nebula, view?: readonly number[], ready?: NebulaPortrait): Photometry {
  const prior = photometry.get(nebula), direction = view?.join(',');
  if (prior && (!view || prior.direction === direction)) return view ? prior.directed! : prior.base;
  const portrait = ready ?? nebulaPortrait(nebula);
  const base = photometry.get(nebula)?.base ?? { luminosities: portrait.luminosities, reflectionHue: portrait.reflectionHue, refinement: portrait.refinement };
  if (!view) return base;
  const measured = measureNebulaPortrait(portrait, view);
  const directed: Photometry = { luminosities: measured.luminosities, reflectionHue: measured.reflectionHue, refinement: portrait.refinement };
  photometry.set(nebula, { base, direction, directed });
  return directed;
}

/** One adjacent-grid convergence step, shared by serial and worker builds. */
export function refineNebulaPortrait(pair: NebulaVolumePair, previous?: NebulaPortrait['luminosities'], sizes: number[] = []): NebulaPortrait {
  const portrait = measureNebulaPortrait(pair);
  const change = previous ? Math.max(...(['lines', 'scattered'] as const).map(key =>
    Math.abs(portrait.luminosities[key] - previous[key]) / Math.max(1e-12, portrait.luminosities[key], previous[key]))) : Infinity;
  portrait.refinement = { sizes: [...sizes, pair.coarse.size], relativeChange: change, converged: change <= 0.15 };
  return portrait;
}

/** Refine only selected portraits, stopping at measured 15% adjacent
 * luminosity agreement or the 96³ work ceiling. This is a convergence
 * indicator, not an absolute-error guarantee for a clumpy cloud. */
export function nebulaPortrait(nebula: Nebula, build: typeof bakeNebulaPair = bakeNebulaPair): NebulaPortrait {
  const prior = cache.get(nebula);
  if (prior) return prior;
  let portrait: NebulaPortrait | undefined;
  for (const size of [32, 48, 64, 96]) {
    portrait = refineNebulaPortrait(build(nebula.cloud, nebula, size), portrait?.luminosities, portrait?.refinement?.sizes);
    if (portrait.refinement!.converged) break;
  }
  photometry.set(nebula, { base: { luminosities: portrait!.luminosities, reflectionHue: portrait!.reflectionHue, refinement: portrait!.refinement } });
  cache.put(nebula, portrait!);
  return portrait!;
}

/** Clip a parallel sightline against a volume, including grazing rays. */
export function nebulaRayInterval(bake: NebulaVolumeBake, origin: readonly number[], direction: readonly number[]): [number, number] {
  let near = -Infinity, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const p = origin[axis] - bake.originPc[axis], d = direction[axis], half = bake.halfExtentsPc[axis];
    if (Math.abs(d) < 1e-12) { if (Math.abs(p) > half) return [0, 0]; continue; }
    const a = (-half - p) / d, b = (half - p) / d;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
  }
  return far > near ? [near, far] : [0, 0];
}
