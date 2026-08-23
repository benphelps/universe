import { deriveSeed } from './hash';
import { Pcg32 } from './pcg32';

/**
 * Per-entity random stream. Every generator receives its own instance;
 * child entities fork sub-streams so sibling draw counts never interact.
 */
export class Rng {
  readonly seed: bigint;
  private readonly pcg: Pcg32;
  private spareNormal: number | null = null;

  constructor(seed: bigint) {
    this.seed = seed;
    this.pcg = new Pcg32(seed);
  }

  /** Independent stream for the child entity at (kindTag, index). */
  fork(kindTag: string, index = 0): Rng {
    return new Rng(deriveSeed(this.seed, kindTag, index));
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.pcg.nextFloat();
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  bool(p = 0.5): boolean {
    return this.float() < p;
  }

  /** Standard normal via Box–Muller (pairs cached). */
  normal(mean = 0, sd = 1): number {
    if (this.spareNormal !== null) {
      const z = this.spareNormal;
      this.spareNormal = null;
      return mean + sd * z;
    }
    let u = 0;
    while (u === 0) u = this.float();
    const v = this.float();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spareNormal = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  }
}
