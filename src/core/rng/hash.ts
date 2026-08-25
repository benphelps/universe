const MASK64 = (1n << 64n) - 1n;

/** Finalizer from splitmix64; bijective on the 64-bit space. */
export function mix64(x: bigint): bigint {
  let z = (x + 0x9e3779b97f4a7c15n) & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

/** Inverse of an odd multiplier modulo 2^64, by Hensel lifting. */
function oddInverse64(a: bigint): bigint {
  let x = a;
  for (let i = 0; i < 6; i++) x = (x * (2n - ((a * x) & MASK64))) & MASK64;
  return x;
}
const INV_MULT_A = oddInverse64(0xbf58476d1ce4e5b9n);
const INV_MULT_B = oddInverse64(0x94d049bb133111ebn);

function invXorShiftRight(y: bigint, shift: bigint): bigint {
  let x = y;
  for (let known = shift; known < 64n; known += shift) x = y ^ (x >> shift);
  return x & MASK64;
}

/**
 * Exact inverse of mix64. Lets a generator construct a seed whose mixed
 * image carries chosen bit fields — the star catalog uses this to address
 * stars by the intrinsic properties their seed encodes.
 */
export function unmix64(z: bigint): bigint {
  let x = invXorShiftRight(z, 31n);
  x = (x * INV_MULT_B) & MASK64;
  x = invXorShiftRight(x, 27n);
  x = (x * INV_MULT_A) & MASK64;
  x = invXorShiftRight(x, 30n);
  return (x - 0x9e3779b97f4a7c15n) & MASK64;
}

/** FNV-1a over UTF-16 code units. */
export function hashString(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h;
}

/**
 * Child seed for the entity at (kindTag, index) under a parent seed.
 * Kind tags keep sibling kinds in disjoint streams regardless of generation order.
 */
export function deriveSeed(parent: bigint, kindTag: string, index = 0): bigint {
  return mix64(mix64(parent ^ hashString(kindTag)) ^ BigInt(index));
}

export function seedToHex(seed: bigint): string {
  return seed.toString(16).padStart(16, '0');
}

export function seedFromHex(hex: string): bigint {
  return BigInt('0x' + hex) & MASK64;
}
