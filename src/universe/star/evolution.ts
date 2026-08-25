import { msLifetimeGyr, msLuminosity, msRadius, radiusFromLT, tEffFromLR } from './mainSequence';
import type { StellarPhysical } from './types';

const BROWN_DWARF_LIMIT = 0.08;
const SUPERNOVA_LIMIT = 8;
const BLACK_HOLE_LIMIT = 20;

/** Fraction of the MS lifetime spent in all post-main-sequence phases. */
const POST_MS_BUDGET = 0.15;

/** Kalirai (2008) initial–final mass relation for white dwarfs, M☉. */
export function whiteDwarfMass(massInitial: number): number {
  return 0.109 * massInitial + 0.394;
}

/** Age at which the star fades to a remnant: main sequence plus the
 *  post-main-sequence budget. The catalog's luminous age bands key on it. */
export function luminousLifetimeGyr(massInitial: number): number {
  return msLifetimeGyr(massInitial) * (1 + POST_MS_BUDGET);
}

/**
 * Physical state as a pure function of zero-age mass and age.
 * Parameterized track segments; luminosity/temperature are interpolated in
 * log space and radius always derived from (L, T) so the three stay
 * Stefan–Boltzmann-consistent.
 */
export function evolve(massInitial: number, ageGyr: number): StellarPhysical {
  if (massInitial < BROWN_DWARF_LIMIT) return brownDwarf(massInitial, ageGyr);

  const tMs = msLifetimeGyr(massInitial);
  if (ageGyr < tMs) return mainSequence(massInitial, ageGyr / tMs);

  const budget = POST_MS_BUDGET * tMs;
  const postAge = ageGyr - tMs;
  if (postAge < budget) return postMainSequence(massInitial, postAge / budget);

  return remnant(massInitial, postAge - budget);
}

function mainSequence(mass: number, f: number): StellarPhysical {
  // ZAMS→TAMS brightening (~×1.7) and modest swelling across the MS.
  const luminosity = 0.75 * msLuminosity(mass) * (1 + 0.73 * f);
  const radius = msRadius(mass) * (0.85 + 0.3 * f);
  return { stage: 'main-sequence', mass, luminosity, radius, tEff: tEffFromLR(luminosity, radius) };
}

/** (L, T) anchor at the end of the main sequence. */
function terminalAnchor(mass: number): { l: number; t: number } {
  const l = 1.3 * msLuminosity(mass);
  return { l, t: tEffFromLR(l, 1.15 * msRadius(mass)) };
}

function postMainSequence(massInitial: number, u: number): StellarPhysical {
  const term = terminalAnchor(massInitial);

  if (massInitial >= SUPERNOVA_LIMIT) {
    // Single supergiant sweep: blue supergiant reddening toward the Hayashi limit.
    const l = logLerp(term.l, 1.8 * term.l, u);
    const t = logLerp(term.t, 3600, u);
    return assemble('supergiant', massInitial, l, t);
  }

  const wdMass = whiteDwarfMass(massInitial);
  const tipT = Math.min(4000, 3300 + 60 * (massInitial - 1));
  const tipL = Math.max(2500, 1.8 * term.l);
  const hbL = Math.max(50, 1.5 * term.l);
  const agbL = Math.max(5000, 2.2 * term.l);

  // Phase boundaries as fractions of the post-MS budget.
  if (u < 0.3) {
    const p = u / 0.3;
    const l = logLerp(term.l, 2.2 * term.l, p);
    const t = logLerp(term.t, 4900, p);
    return assemble('subgiant', massInitial, l, t);
  }
  if (u < 0.7) {
    const p = (u - 0.3) / 0.4;
    const l = logLerp(2.2 * term.l, tipL, p);
    const t = logLerp(4900, tipT, p);
    return assemble('giant', massInitial, l, t, lerp(massInitial, wdMass, 0.15 * p));
  }
  if (u < 0.85) {
    // Helium flash: rapid settling onto the clump, then hold.
    const p = Math.min(1, ((u - 0.7) / 0.15) * 5);
    const l = logLerp(tipL, hbL, p);
    const t = logLerp(tipT, 4800, p);
    return assemble('horizontal-branch', massInitial, l, t, lerp(massInitial, wdMass, 0.2));
  }
  const p = (u - 0.85) / 0.15;
  const l = logLerp(hbL, agbL, p);
  const t = logLerp(4800, 3000, p);
  return assemble('agb', massInitial, l, t, lerp(massInitial, wdMass, 0.2 + 0.8 * p));
}

function remnant(massInitial: number, coolingGyr: number): StellarPhysical {
  if (massInitial >= BLACK_HOLE_LIMIT) {
    const mass = Math.min(60, Math.max(3, 0.35 * massInitial));
    // Schwarzschild radius: 2.95 km per M☉, in R☉.
    return { stage: 'black-hole', mass, luminosity: 0, radius: 4.24e-6 * mass, tEff: 0 };
  }
  if (massInitial >= SUPERNOVA_LIMIT) {
    const mass = Math.min(2.1, 1.2 + 0.05 * (massInitial - SUPERNOVA_LIMIT));
    const radius = 1.72e-5; // 12 km
    const tEff = Math.min(1e6, Math.max(3e4, 1e6 * (Math.max(coolingGyr, 1e-6) / 0.001) ** -0.5));
    const luminosity = radius ** 2 * (tEff / 5772) ** 4;
    return { stage: 'neutron-star', mass, radius, tEff, luminosity };
  }
  const mass = whiteDwarfMass(massInitial);
  const radius = 0.01 * (mass / 0.6) ** (-1 / 3);
  // Mestel-like cooling track.
  const luminosity = Math.min(100, 0.04 * (Math.max(coolingGyr, 1e-4) / 0.1) ** -1.4);
  return { stage: 'white-dwarf', mass, radius, luminosity, tEff: tEffFromLR(luminosity, radius) };
}

function brownDwarf(mass: number, ageGyr: number): StellarPhysical {
  // Burrows-style cooling: T ∝ M^0.83 · t^-0.32.
  const tEff = clamp(
    1900 * (mass / 0.05) ** 0.83 * Math.max(ageGyr, 0.05) ** -0.32,
    250,
    2800,
  );
  const radius = 0.1;
  const luminosity = radius ** 2 * (tEff / 5772) ** 4;
  return { stage: 'brown-dwarf', mass, radius, tEff, luminosity };
}

function assemble(
  stage: StellarPhysical['stage'],
  mass: number,
  luminosity: number,
  tEff: number,
  currentMass = mass,
): StellarPhysical {
  return { stage, mass: currentMass, luminosity, tEff, radius: radiusFromLT(luminosity, tEff) };
}

function logLerp(a: number, b: number, t: number): number {
  return a * (b / a) ** t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
