import { AU, C_LIGHT, G, SOLAR_MASS, SOLAR_RADIUS, YEAR } from '../../core/physics/constants';
import {
  eddingtonLuminosity,
  gravitationalRadius,
  radiativeEfficiency,
} from '../../core/physics/blackHole';
import type { StellarPhysical } from './types';
import {
  massLossRate,
  rocheLobeFraction,
  thermalTimescale,
  windSpeedAt,
} from './stellarWind';

/**
 * What feeds a stellar-mass black hole.
 *
 * Nothing, usually. A hole drifting alone in the interstellar medium
 * captures gas at a rate that rounds to nothing against its Eddington
 * limit — some twenty orders of magnitude below it — and is a lens and
 * a shadow and no light of its own. The ones that shine are the ones
 * with a companion close enough to lose material to them, and there the
 * brightness is decided entirely by the pair: how much the donor sheds,
 * how fast it leaves, how far it has to cross, and whether the donor has
 * swollen far enough to spill over its own Roche lobe rather than merely
 * blow past.
 *
 * None of that is a switch. Every one of those numbers is already in the
 * system — the companion's mass, radius, luminosity, temperature, and
 * the orbit between them — so whether a given black hole is dark, a
 * faint wind-fed X-ray source, or a bright accreting binary is settled
 * by the system it was generated into.
 */

export type FeedingMode = 'starved' | 'wind-fed' | 'roche-lobe';

export interface CompactFeeding {
  mode: FeedingMode;
  /** Ṁ reaching the hole, kg/s. */
  rateKgPerS: number;
  /** L/L_Edd of the flow that rate supports. */
  eddingtonRatio: number;
  /** Which companion is doing it, or −1 when nothing is. */
  donorIndex: number;
  /** Separation to that donor, AU. */
  separationAu: number;
}

/** A donor, reduced to what the accretion actually depends on. */
export interface Donor {
  star: StellarPhysical;
  /** Orbital semi-major axis about the hole, AU. */
  separationAu: number;
}

/**
 * Density of the interstellar medium a wandering hole sits in, kg/m³:
 * one hydrogen atom per cubic centimetre, the warm neutral phase that
 * fills most of a disk's volume.
 */
const ISM_DENSITY = 1.67e-21;
/** Sound speed plus turbulence in that gas, m/s — the denominator of
 *  Bondi capture, and the reason it is as hopeless as it is. */
const ISM_SPEED = 3e4;
/** Where a flow stops being able to cool as fast as it falls — the same
 *  boundary the galactic nucleus splits its two regimes on. */
const RADIATIVE_THRESHOLD = 0.01;

/**
 * Bondi–Hoyle–Lyttleton capture: a gravitating body moving through gas
 * sweeps out a cylinder of radius 2GM/v², where v is its speed through
 * that gas combined with the gas's own sound speed. Everything inside
 * that radius is deflected enough to fall in.
 */
export function bondiRate(massSolar: number, densityKgM3: number, speedMs: number): number {
  const m = massSolar * SOLAR_MASS;
  const v = Math.max(speedMs, 1);
  return (4 * Math.PI * G * G * m * m * densityKgM3) / (v * v * v);
}

/**
 * The rate at which a hole catches a companion's wind. The wind leaves
 * the donor in every direction at once, so the hole intercepts only the
 * fraction its capture cylinder subtends at that distance — which falls
 * as the square of the separation and the fourth power of the wind's
 * speed, and is why a fast hot wind is so much harder to catch than a
 * slow cool one even when it carries more material.
 */
export function windCaptureRate(
  massSolar: number,
  donor: StellarPhysical,
  separationAu: number,
): number {
  const shed = massLossRate(donor);
  if (shed <= 0) return 0;
  const a = Math.max(separationAu, 1e-6) * AU;
  const wind = windSpeedAt(donor, a);
  // The orbit contributes to the speed the hole meets the wind at.
  const orbital = Math.sqrt(
    (G * (massSolar + donor.mass) * SOLAR_MASS) / a,
  );
  const relative = Math.hypot(wind, orbital);
  const capture = (2 * G * massSolar * SOLAR_MASS) / (relative * relative);
  // The share of a sphere of radius a that the capture disc covers.
  const fraction = (capture * capture) / (4 * a * a);
  return shed * Math.min(fraction, 1);
}

/**
 * The rate once the donor overflows its Roche lobe and pours across the
 * inner Lagrange point rather than blowing past.
 *
 * Which timescale governs depends on the mass ratio. A donor heavier
 * than the accretor shrinks its own lobe by giving mass away, so the
 * overflow deepens as it proceeds and the star can only respond as fast
 * as it can restructure — its thermal time, which for a giant is a few
 * ten-thousand years and gives a ferociously bright, short-lived
 * transfer. A lighter donor widens the orbit instead, and the transfer
 * is then limited by whatever slowly pushed the star into contact,
 * which is its own expansion as it evolves: nuclear time, ten thousand
 * times longer, and the reason most X-ray binaries are the faint ones.
 */
export function overflowRate(massSolar: number, donor: StellarPhysical): number {
  const donorMass = donor.mass * SOLAR_MASS;
  const thermal = thermalTimescale(donor);
  if (donor.mass > massSolar) return donorMass / thermal;
  // Nuclear time is the envelope's thermal time stretched by the ratio
  // of the fuel it can burn to the energy binding it — of order a
  // thousand for a star that has left the main sequence.
  return donorMass / (thermal * 1000);
}

/**
 * How a compact remnant of this mass is being fed by the company it
 * keeps. Every companion is tested; the one that delivers most wins,
 * since a hole in a hierarchy is lit by whichever star is actually
 * reaching it.
 */
export function feedingFor(
  massSolar: number,
  spin: number,
  donors: readonly Donor[],
): CompactFeeding {
  let best: CompactFeeding = {
    mode: 'starved',
    // Alone in the interstellar medium a hole still catches something,
    // and it is worth carrying the real number rather than zero: it is
    // what says how far from shining these objects are.
    rateKgPerS: bondiRate(massSolar, ISM_DENSITY, ISM_SPEED),
    eddingtonRatio: 0,
    donorIndex: -1,
    separationAu: 0,
  };

  for (let i = 0; i < donors.length; i++) {
    const { star, separationAu } = donors[i];
    if (star.mass <= 0 || star.radius <= 0) continue;
    const lobe =
      rocheLobeFraction(star.mass / Math.max(massSolar, 1e-6)) * separationAu * AU;
    const overflowing = star.radius * SOLAR_RADIUS >= lobe;
    const rate = overflowing
      ? overflowRate(massSolar, star)
      : windCaptureRate(massSolar, star, separationAu);
    if (rate > best.rateKgPerS) {
      best = {
        mode: overflowing ? 'roche-lobe' : 'wind-fed',
        rateKgPerS: rate,
        eddingtonRatio: 0,
        donorIndex: i,
        separationAu,
      };
    }
  }

  best.eddingtonRatio = eddingtonRatioFor(massSolar, spin, best.rateKgPerS);
  return best;
}

/**
 * The Eddington ratio a given supply rate actually supports.
 *
 * Above a percent or so of Eddington the gas cools faster than it falls
 * and radiates its orbital energy away at the full efficiency the
 * geometry allows, so the light is proportional to the supply. Below
 * that it cannot: the flow puffs up, holds its heat, and carries most
 * of it through the horizon instead of radiating it, and the efficiency
 * falls in step with the rate. So the luminosity goes as the square of
 * the supply rather than as the supply, and by the time a hole is
 * feeding on interstellar gas alone that squaring has taken it another
 * four orders of magnitude down.
 *
 * This is the whole reason isolated black holes are not a class of
 * object anyone has catalogued. Fed at the thin-disc efficiency, the
 * one drifting through the warm neutral medium would shine at a third
 * of a solar luminosity and be an easy find.
 */
export function eddingtonRatioFor(
  massSolar: number,
  spin: number,
  rateKgPerS: number,
): number {
  const efficiency = radiativeEfficiency(spin);
  const supply =
    (efficiency * rateKgPerS * C_LIGHT * C_LIGHT) / eddingtonLuminosity(massSolar);
  return supply >= RADIATIVE_THRESHOLD
    ? supply
    : (supply * supply) / RADIATIVE_THRESHOLD;
}

/** Ṁ in solar masses per year, for anything that has to read it. */
export function solarMassesPerYear(rateKgPerS: number): number {
  return (rateKgPerS * YEAR) / SOLAR_MASS;
}

/** Gravitational radius of this hole, metres — the scale everything the
 *  renderer draws is quoted in. */
export function holeGravitationalRadiusM(massSolar: number): number {
  return gravitationalRadius(massSolar);
}
