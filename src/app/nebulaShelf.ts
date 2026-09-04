import type { NebulaVolumeBake } from '../universe/galaxy/nebulaVolume';

/**
 * Landed nebula bakes, kept for the clouds the camera comes back to.
 *
 * A bake a volume is standing on is held: it is never let go, and it
 * costs the shelf nothing, since its grid lives in the volume's
 * texture whether the shelf keeps it or not. The rest are the loose
 * bakes — clouds residency has moved on from — and those are bounded
 * by what they hold rather than how many, a near-grade grid being
 * sixteen megabytes where a far one is three and a half. Room is made
 * from the bakes least recently asked for.
 */
export class NebulaShelf {
  private readonly bakes = new Map<string, NebulaVolumeBake>();
  private readonly holds = new Map<string, number>();
  private looseBytes = 0;

  constructor(readonly looseBudgetBytes: number) {}

  get size(): number {
    return this.bakes.size;
  }

  /** Bytes of bakes nothing stands on. */
  get loose(): number {
    return this.looseBytes;
  }

  /** The bake under a key, freshened as the most recently wanted. */
  get(key: string): NebulaVolumeBake | undefined {
    const bake = this.bakes.get(key);
    if (!bake) return undefined;
    this.bakes.delete(key);
    this.bakes.set(key, bake);
    return bake;
  }

  put(key: string, bake: NebulaVolumeBake): void {
    const standing = this.bakes.get(key);
    if (standing && !this.holds.has(key)) this.looseBytes -= standing.data.byteLength;
    this.bakes.delete(key);
    this.bakes.set(key, bake);
    if (!this.holds.has(key)) this.looseBytes += bake.data.byteLength;
    this.trim();
  }

  /** Keep a bake for as long as something stands on it. */
  hold(key: string): void {
    const bake = this.bakes.get(key);
    if (!bake) return;
    const count = this.holds.get(key) ?? 0;
    if (count === 0) this.looseBytes -= bake.data.byteLength;
    this.holds.set(key, count + 1);
  }

  /** One less thing standing on it; loose again once nothing is. */
  release(key: string): void {
    const count = this.holds.get(key);
    if (!count) return;
    if (count > 1) {
      this.holds.set(key, count - 1);
      return;
    }
    this.holds.delete(key);
    const bake = this.get(key);
    if (bake) this.looseBytes += bake.data.byteLength;
    this.trim();
  }

  private trim(): void {
    for (const [key, bake] of this.bakes) {
      if (this.looseBytes <= this.looseBudgetBytes) return;
      if (this.holds.has(key)) continue;
      this.bakes.delete(key);
      this.looseBytes -= bake.data.byteLength;
    }
  }
}
