const MiB = 2 ** 20;
export const NEBULA_POOL_SIZE = 3;
/** Partition a 1.25 GiB nebula payload allowance. This excludes the rest
 * of the renderer, JS/driver overhead and garbage awaiting collection. */
export const NEBULA_MEMORY_BYTES = 1280 * MiB;
export const NEBULA_RESIDENT_BYTES = 256 * MiB;
export const NEBULA_LOOSE_BYTES = 128 * MiB;
// Per worker: 80 MiB GPU storage, 8 MiB readback, <17 MiB centered
// photon geometry, plus allowance for small retained fields/program data.
export const NEBULA_RETAINED_WORKER_BYTES = NEBULA_POOL_SIZE * 112 * MiB;
// Three copied 96³ pairs plus one pair's GPU textures while mapping tiles.
export const NEBULA_PORTRAIT_BYTES = 32 * MiB;
export const NEBULA_WORKING_BYTES = NEBULA_MEMORY_BYTES - NEBULA_RESIDENT_BYTES
  - NEBULA_LOOSE_BYTES - NEBULA_RETAINED_WORKER_BYTES - NEBULA_PORTRAIT_BYTES;

/** One or two grids on CPU and GPU, plus packed continuum CPU/GPU and
 * occupancy. The held CPU bake is counted here, not again in the loose shelf. */
export function nebulaResidentBytes(size: number, domains = 2): number {
  return 8 * domains * size ** 3 + 2 * MiB;
}

/** Carrier uniforms contain arrays for merged volumes; use the actual box. */
export function nebulaApparentSize(volume: { box: { halfPc: number }; cameraDistancePc: number }): number {
  return volume.box.halfPc / Math.max(1, volume.cameraDistancePc);
}

/** Includes future uploads and fading residents, so simultaneous results
 * and warm-cache arrivals cannot oversubscribe the resident allocation. */
export class NebulaResidentBudget {
  private readonly claims = new Map<bigint, number>();
  private used = 0;
  constructor(readonly capacity = NEBULA_RESIDENT_BYTES) {}
  get bytes(): number { return this.used; }
  canReserve(seed: bigint, size: number, domains = 2, overlapBytes = 0): boolean {
    return this.used + Math.max(0, nebulaResidentBytes(size, domains) + overlapBytes - (this.claims.get(seed) ?? 0)) <= this.capacity;
  }
  reserve(seed: bigint, size: number, domains = 2, overlapBytes = 0): boolean {
    if (!this.canReserve(seed, size, domains, overlapBytes)) return false;
    const before = this.claims.get(seed) ?? 0, bytes = Math.max(before, nebulaResidentBytes(size, domains) + overlapBytes);
    this.claims.set(seed, bytes); this.used += bytes - before;
    return true;
  }
  /** Drop overlap only after replacement, with no higher grade in flight. */
  settle(seed: bigint, size: number, domains = 2): void {
    const before = this.claims.get(seed) ?? 0;
    const bytes = nebulaResidentBytes(size, domains);
    if (bytes > before) throw new Error('Unreserved nebula resident');
    this.claims.set(seed, bytes); this.used += bytes - before;
  }
  retain(seeds: ReadonlySet<bigint>): void {
    for (const seed of this.claims.keys()) if (!seeds.has(seed)) this.release(seed);
  }
  release(seed: bigint): void {
    this.used -= this.claims.get(seed) ?? 0; this.claims.delete(seed);
  }
  clear(): void { this.claims.clear(); this.used = 0; }
}
