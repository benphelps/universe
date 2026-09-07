const MASK64 = (1n << 64n) - 1n;
const WORD = 0x100000000;

/** PCG32 (XSH-RR): 64-bit state, 32-bit output. */
export class Pcg32 {
  private lo = 0;
  private hi = 0;
  private readonly incLo: number;
  private readonly incHi: number;

  constructor(seed: bigint, streamId = 0n) {
    const inc = ((streamId << 1n) | 1n) & MASK64;
    this.incLo = Number(inc & 0xffffffffn);
    this.incHi = Number(inc >> 32n);
    this.nextUint32();
    const wrapped = seed & MASK64;
    const sum = this.lo + Number(wrapped & 0xffffffffn);
    this.lo = sum >>> 0;
    this.hi = (this.hi + Number(wrapped >> 32n) + (sum >= WORD ? 1 : 0)) >>> 0;
    this.nextUint32();
  }

  nextUint32(): number {
    const lo = this.lo, hi = this.hi;
    // Exact modulo-2^64 multiply by 0x5851f42d4c957f2d. The low
    // product's high word uses 16-bit limbs so every carry is exact
    // in a JS number; cross-products need only their low 32 bits.
    const lowProduct = (lo & 0xffff) * 0x7f2d;
    const middle = (lo >>> 16) * 0x7f2d + (lo & 0xffff) * 0x4c95 + (lowProduct >>> 16);
    const highProduct = (lo >>> 16) * 0x4c95 + Math.floor(middle / 65536);
    const sum = (((middle << 16) | (lowProduct & 0xffff)) >>> 0) + this.incLo;
    this.lo = sum >>> 0;
    this.hi = (Math.imul(hi, 0x4c957f2d) + Math.imul(lo, 0x5851f42d)
      + highProduct + this.incHi + (sum >= WORD ? 1 : 0)) >>> 0;
    const xorLo = ((lo >>> 18) | (hi << 14)) ^ lo;
    const xorHi = (hi >>> 18) ^ hi;
    const xorshifted = (xorLo >>> 27) | (xorHi << 5);
    const rot = hi >>> 27;
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** Uniform in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() * 2 ** -32;
  }
}
