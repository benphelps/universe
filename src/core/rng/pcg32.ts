const MASK64 = (1n << 64n) - 1n;
const MULT = 6364136223846793005n;

/** PCG32 (XSH-RR): 64-bit state, 32-bit output. */
export class Pcg32 {
  private state: bigint;
  private readonly inc: bigint;

  constructor(seed: bigint, streamId = 0n) {
    this.inc = ((streamId << 1n) | 1n) & MASK64;
    this.state = 0n;
    this.nextUint32();
    this.state = (this.state + seed) & MASK64;
    this.nextUint32();
  }

  nextUint32(): number {
    const old = this.state;
    this.state = (old * MULT + this.inc) & MASK64;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** Uniform in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() * 2 ** -32;
  }
}
