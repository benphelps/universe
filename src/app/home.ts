import { seedToHex } from '../core/rng/hash';
import { PRIME_GALAXY_SEED } from '../universe/galaxy/galaxySeed';

/**
 * Where the traveler lives: the galaxy a bare visit boots into. Set
 * in one place only, by the traveler choosing it — a link decides
 * nothing but the trip. Absent means the shared prime galaxy.
 */
export const GALAXY_KEY = 'universe-galaxy';

export const PRIME_GALAXY_HEX = seedToHex(PRIME_GALAXY_SEED);

/** A fresh 64-bit seed, hex: a galaxy or a system nobody has stood in. */
export function randomHex(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return words[0].toString(16).padStart(8, '0') + words[1].toString(16).padStart(8, '0');
}

/** The home galaxy, hex. */
export function homeGalaxy(): string {
  try {
    return localStorage.getItem(GALAXY_KEY) ?? PRIME_GALAXY_HEX;
  } catch {
    return PRIME_GALAXY_HEX;
  }
}

/** Whether a galaxy was ever chosen — the welcome asks until one is. */
export function homeChosen(): boolean {
  try {
    return localStorage.getItem(GALAXY_KEY) !== null;
  } catch {
    return false;
  }
}

export function setHomeGalaxy(hex: string): void {
  try {
    if (hex === PRIME_GALAXY_HEX) localStorage.removeItem(GALAXY_KEY);
    else localStorage.setItem(GALAXY_KEY, hex);
  } catch {
    // Storage unavailable: home lasts as long as the page.
  }
}
