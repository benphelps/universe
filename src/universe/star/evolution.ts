import { msLifetimeGyr, msLuminosity, msRadius, radiusFromLT, tEffFromLR } from './mainSequence';
import { massiveAgeBreaksGyr, massiveFinalMass, massiveLifetimeGyr, massiveStarState } from './massiveTracks';
import type { StellarPhysical } from './types';
import { C_LIGHT, GYR, SOLAR_LUMINOSITY, SOLAR_MASS } from '../../core/physics/constants';

const BROWN_DWARF_LIMIT = 0.08;
const SUPERNOVA_LIMIT = 8;
const BLACK_HOLE_LIMIT = 20;

/** Approximate nuclear yields, in L☉ Gyr per solar mass of fuel. The
 * shell fuel is initially X=0.70 hydrogen; helium burns to C/O. Neutrino
 * losses and chemical enrichment of ejecta are outside this compact model. */
const REST_ENERGY = SOLAR_MASS * C_LIGHT ** 2 / (SOLAR_LUMINOSITY * GYR);
const HYDROGEN_SHELL_YIELD = 0.70 * 0.007 * REST_ENERGY;
const HELIUM_YIELD = 0.0006 * REST_ENERGY;
const MS_MEAN_L_FACTOR = 0.75 * (1 + 0.73 / 2);
const TERMINAL_L_FACTOR = 0.75 * (1 + 0.73);

/** Kalirai (2008) linear IFMR, with a 0.53 M☉ low-mass plateau rather
 * than extrapolation below the observed range. Never manufacture mass
 * in the far-future, low-mass extension. This is not a metallicity fit. */
export function whiteDwarfMass(massInitial: number): number {
  return Math.min(massInitial, Math.max(0.53, 0.109 * massInitial + 0.394));
}

interface GiantTrack {
  subL: number;
  tipL: number;
  hbL: number;
  agbL: number;
  sub: number;
  rgb: number;
  settle: number;
  horizontal: number;
  agb: number;
  duration: number;
  /** L^(-5/6) endpoints of a shell-burning rise with L ∝ core mass^6. */
  rgbA: number;
  rgbB: number;
}

// Population quadrature evaluates many ages at exactly one mass. A one-entry
// cache avoids rebuilding the clock for every age, without a growing seed cache.
let lastMass = NaN;
let lastTrack: GiantTrack;
function giantTrack(mass: number): GiantTrack {
  if (mass === lastMass) return lastTrack;
  const lMs = msLuminosity(mass), tMs = msLifetimeGyr(mass);
  const termL = TERMINAL_L_FACTOR * lMs;
  const subL = 2.2 * termL;
  const tipL = Math.max(2500, 1.8 * termL);
  const hbL = Math.max(50, 1.5 * termL);
  const agbL = Math.max(5000, 2.2 * termL);
  const finalMass = whiteDwarfMass(mass);
  // Count the MS fuel first. Only the remaining processed material retained
  // in the remnant funds the later shell burning. These phase allocations
  // are a conservative procedural approximation, not an SSE/MIST track fit.
  const shellEnergy = Math.max(0, finalMass * HYDROGEN_SHELL_YIELD - MS_MEAN_L_FACTOR * lMs * tMs);
  const subEnergy = Math.min(0.045 * tMs * logMean(termL, subL), 0.1 * shellEnergy);
  const remaining = shellEnergy - subEnergy;
  const rgbEnergy = 0.80 * remaining;
  const heEnergy = finalMass * HELIUM_YIELD;
  const horizontalEnergy = 0.08 * remaining + 0.90 * heEnergy;
  const agbEnergy = 0.12 * remaining + 0.10 * heEnergy;
  const rgbA = subL ** (-5 / 6), rgbB = tipL ** (-5 / 6);
  const rgbMean = Math.abs(tipL / subL - 1) < 1e-8 ? subL
    : 5 * (tipL ** (1 / 6) - subL ** (1 / 6)) / (rgbA - rgbB);
  const sub = subEnergy / logMean(termL, subL);
  const rgb = rgbEnergy / rgbMean;
  // Surface readjustment after helium ignition, not the internal flash
  // luminosity. Cap both its elapsed time and its share of the He-phase fuel.
  const settle = Math.min(0.0002, 0.02 * horizontalEnergy / logMean(tipL, hbL));
  const horizontal = (horizontalEnergy - settle * logMean(tipL, hbL)) / hbL;
  const agb = agbEnergy / logMean(hbL, agbL);
  lastMass = mass;
  return lastTrack = { subL, tipL, hbL, agbL, sub, rgb, settle, horizontal, agb,
    duration: sub + rgb + settle + horizontal + agb, rgbA, rgbB };
}

/** Remnant-birth age: fuel-limited WD clock or end of massive reference
 * track (end-C / early-AGB endpoint; not an explosion simulation). */
export function luminousLifetimeGyr(massInitial: number): number {
  return massInitial >= SUPERNOVA_LIMIT ? massiveLifetimeGyr(massInitial)
    : msLifetimeGyr(massInitial) + giantTrack(massInitial).duration;
}

/** Integration breakpoints shared with evolve(), including extra samples
 * along the accelerating RGB and every retained massive-track knot. Slot
 * counts are constant within each track family, not across the 8-M☉ boundary. */
export function evolutionAgeBreaksGyr(massInitial: number): number[] {
  if (massInitial < BROWN_DWARF_LIMIT) {
    const t = 1900 * (massInitial / 0.05) ** 0.83;
    return [0.05, (t / 2800) ** (1 / 0.32), (t / 250) ** (1 / 0.32)];
  }
  const tMs = msLifetimeGyr(massInitial);
  let bounds: number[];
  if (massInitial >= SUPERNOVA_LIMIT) {
    bounds = massiveAgeBreaksGyr(massInitial);
  } else {
    const track = giantTrack(massInitial);
    const rgbStart = tMs + track.sub;
    bounds = [tMs, rgbStart];
    for (let i = 1; i <= 8; i++) {
      const l = logLerp(track.subL, track.tipL, i / 8);
      const p = Math.abs(track.rgbA - track.rgbB) < 1e-12 ? i / 8
        : (l ** (-5 / 6) - track.rgbA) / (track.rgbB - track.rgbA);
      bounds.push(rgbStart + track.rgb * p);
    }
    const rgbEnd = rgbStart + track.rgb;
    bounds.push(rgbEnd + track.settle, rgbEnd + track.settle + track.horizontal, tMs + track.duration);
  }
  const end = bounds[bounds.length - 1];
  return [...bounds,
    // Cooling has sharp caps close to remnant birth and a long tail.
    ...[1e-4, 0.1 * (0.04 / 100) ** (1 / 1.4), 0.001, 0.01, 0.1, 1, 10].map(t => end + t)];
}

/**
 * Physical state as a pure function of zero-age mass and age.
 * Parameterized track segments, with an accelerating shell-burning RGB;
 * radius is derived from (L, T) so the three stay Stefan–Boltzmann-consistent.
 */
export function evolve(massInitial: number, ageGyr: number): StellarPhysical {
  if (massInitial < BROWN_DWARF_LIMIT) return brownDwarf(massInitial, ageGyr);
  if (massInitial >= SUPERNOVA_LIMIT) {
    const end = massiveLifetimeGyr(massInitial);
    return ageGyr < end ? massiveStarState(massInitial, ageGyr)
      : remnant(massInitial, ageGyr - end, massiveFinalMass(massInitial));
  }

  const tMs = msLifetimeGyr(massInitial);
  if (ageGyr < tMs) return mainSequence(massInitial, ageGyr / tMs);

  const budget = giantTrack(massInitial).duration;
  const postAge = ageGyr - tMs;
  if (postAge < budget) return postMainSequence(massInitial, postAge);

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
  const l = TERMINAL_L_FACTOR * msLuminosity(mass);
  return { l, t: tEffFromLR(l, 1.15 * msRadius(mass)) };
}

function postMainSequence(massInitial: number, age: number): StellarPhysical {
  const term = terminalAnchor(massInitial);
  const track = giantTrack(massInitial);
  const wdMass = whiteDwarfMass(massInitial);
  const tipT = Math.min(4000, 3300 + 60 * (massInitial - 1));
  if (age < track.sub) {
    const p = age / track.sub;
    return assemble('subgiant', massInitial, logLerp(term.l, track.subL, p), logLerp(term.t, 4900, p));
  }
  age -= track.sub;
  if (age < track.rgb) {
    const p = age / track.rgb;
    const l = lerp(track.rgbA, track.rgbB, p) ** (-6 / 5);
    const progress = Math.abs(track.tipL / track.subL - 1) < 1e-8 ? p
      : Math.log(l / track.subL) / Math.log(track.tipL / track.subL);
    return assemble('giant', massInitial, l, logLerp(4900, tipT, progress), lerp(massInitial, wdMass, 0.2 * progress));
  }
  age -= track.rgb;
  if (age < track.settle + track.horizontal) {
    const p = Math.min(1, age / track.settle);
    return assemble('horizontal-branch', massInitial, logLerp(track.tipL, track.hbL, p),
      logLerp(tipT, 4800, p), lerp(massInitial, wdMass, 0.2));
  }
  age -= track.settle + track.horizontal;
  const p = Math.min(1, age / track.agb);
  return assemble('agb', massInitial, logLerp(track.hbL, track.agbL, p), logLerp(4800, 3000, p),
    lerp(massInitial, wdMass, 0.2 + 0.8 * p));
}

function remnant(massInitial: number, coolingGyr: number, availableMass = massInitial): StellarPhysical {
  if (massInitial >= BLACK_HOLE_LIMIT) {
    // The inherited collapse prescription must not reclaim wind ejecta.
    const mass = Math.min(availableMass, 60, Math.max(3, 0.35 * massInitial));
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

/** Mean of a luminosity interpolated exponentially in time. */
function logMean(a: number, b: number): number {
  return Math.abs(b / a - 1) < 1e-8 ? a : (b - a) / Math.log(b / a);
}
