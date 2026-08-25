import { deriveSeed, mix64, unmix64 } from '../../core/rng/hash';
import { UNIVERSE_SEED } from '../galaxy/sectors';
import { initialMassFromUnit, massUnitForMass } from './imf';

/**
 * A star's intrinsic identity lives in its seed. The mixed image of the
 * seed carries three bit fields — a mass unit, an age unit, and free
 * entropy — and the unit fields pass through the explicit population
 * inverse CDFs. For an arbitrary seed the fields are uniform, so the
 * IMF and age distributions come out exactly as before; for a catalog
 * star the fields were chosen, which is how a sector cell can enumerate
 * only the stars massive enough and young enough to be seen. Either way
 * the same seed always resolves to the same star.
 */
export const MASS_BITS = 24;
export const AGE_BITS = 24;
export const ENTROPY_BITS = 16;
export const MASS_BIT_SPAN = 2 ** MASS_BITS;
export const AGE_BIT_SPAN = 2 ** AGE_BITS;

const IDENTITY_SALT = deriveSeed(UNIVERSE_SEED, 'identity');
const AGE_MASK = BigInt(AGE_BIT_SPAN - 1);

export function massBitsOf(seed: bigint): number {
  return Number(mix64(seed ^ IDENTITY_SALT) >> 40n);
}

export function ageBitsOf(seed: bigint): number {
  return Number((mix64(seed ^ IDENTITY_SALT) >> 16n) & AGE_MASK);
}

/** Unit value in (0, 1) from a bit field (half-step keeps ends open). */
export function unitFromBits(bits: number, span: number): number {
  return (bits + 0.5) / span;
}

/** Zero-age mass encoded in the seed. */
export function initialMassOf(seed: bigint): number {
  return initialMassFromUnit(unitFromBits(massBitsOf(seed), MASS_BIT_SPAN));
}

/** Age unit encoded in the seed (resolve via populationFromUnit). */
export function ageUnitOf(seed: bigint): number {
  return unitFromBits(ageBitsOf(seed), AGE_BIT_SPAN);
}

/** The seed whose identity fields hold exactly these bits. */
export function seedForIdentity(massBits: number, ageBits: number, entropy: number): bigint {
  const target =
    (BigInt(massBits) << 40n) | (BigInt(ageBits) << 16n) | BigInt(entropy & 0xffff);
  return unmix64(target) ^ IDENTITY_SALT;
}

/** Smallest mass-bit value whose decoded mass is at least this mass. */
export function massBitsAtLeast(mass: number): number {
  // unitFromBits is (bits + 0.5) / span, so invert with the half-step.
  return Math.min(
    MASS_BIT_SPAN,
    Math.max(0, Math.ceil(massUnitForMass(mass) * MASS_BIT_SPAN - 0.5)),
  );
}
