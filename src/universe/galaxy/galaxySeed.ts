/**
 * Which galaxy this session materializes. The universe is the math —
 * every 64-bit galaxy seed names a complete galaxy with its own arms,
 * clouds, names, and homes — and this is the one seed the session
 * commits to. It defaults to the shared prime galaxy every traveler
 * knows, and locks at first use: everything derived from a galaxy
 * must come from the same one.
 */

/** The shared prime galaxy ("SIM_UNIV" in ASCII). */
export const PRIME_GALAXY_SEED = 0x53494d5f554e4956n;

let current = PRIME_GALAXY_SEED;
let locked = false;

/** Select the session's galaxy; must precede any derivation from it.
 *  Setting the same value again is always allowed. */
export function setGalaxySeed(seed: bigint): void {
  if (locked && seed !== current) {
    throw new Error('galaxy seed is locked after first use');
  }
  current = seed;
}

export function galaxySeed(): bigint {
  locked = true;
  return current;
}

/**
 * A subsystem's derivation root in the current galaxy. In the prime
 * galaxy this is the base itself — bit-identical to the era before
 * galaxies were seedable — and in any other galaxy it shifts with the
 * seed, carrying every derivation chain with it.
 */
export function galaxyRoot(base: bigint): bigint {
  return base ^ galaxySeed() ^ PRIME_GALAXY_SEED;
}
