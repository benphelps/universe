import {
  clampSpin,
  gravitationalRadius,
  hawkingTemperature,
  horizonRadiusRg,
  iscoRadiusRg,
  photonSphereRadiusRg,
  shadowImpactParameterRg,
} from '../../core/physics/blackHole';
import { C_LIGHT, G, PARSEC, SOLAR_MASS } from '../../core/physics/constants';
import { accretionFlowFor, type AccretionFlow } from './accretionFlow';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { galaxyRoot } from './galaxySeed';
import { centralSpheroid, nuclearStarCluster, type NuclearStarCluster } from './spheroid';

/**
 * The supermassive black hole at the galaxy's centre, and whatever it
 * is currently eating.
 *
 * Nothing here is chosen for looks. The mass comes from the bulge the
 * galaxy actually has, through the relation black holes and bulges are
 * observed to obey — and through the *right* branch of it, since a
 * pseudobulge hosts a hole an order of magnitude lighter than a
 * classical bulge of the same mass (the Milky Way's is the textbook
 * case). Mass and spin then fix every length in the geometry exactly:
 * horizon, photon orbit, innermost stable orbit, shadow. Spin also
 * fixes how efficiently the hole converts what falls in, so the
 * accretion rate follows from the luminosity and nothing is left over
 * to tune.
 *
 * What it is eating, and what that makes of it, is accretionFlow.
 */

export interface GalacticNucleus {
  massSolar: number;
  /** Dimensionless a★ = Jc/GM²; positive is prograde with the disc. */
  spin: number;
  /** GM/c², metres — the unit every other length is quoted in. */
  gravitationalRadiusM: number;
  horizonRadiusM: number;
  photonSphereRadiusM: number;
  iscoRadiusM: number;
  /** Apparent radius of the shadow to a distant viewer, metres. */
  shadowRadiusM: number;
  /** Where the hole outweighs the stars around it, pc. */
  influenceRadiusPc: number;
  /** Orbital period at the innermost stable orbit, seconds. */
  iscoPeriodS: number;
  /** Unit spin axis in galactic coordinates — the accretion flow lies
   *  perpendicular to it. Fed by the bar, the hole ends up loosely
   *  aligned with the disk it eats from, never exactly. */
  spinAxisGalactic: [number, number, number];
  hawkingTemperatureK: number;
  cluster: NuclearStarCluster;
  flow: AccretionFlow;
}

let memo: GalacticNucleus | null = null;

export function galacticNucleus(): GalacticNucleus {
  if (memo) return memo;
  const spheroid = centralSpheroid();
  const rng = new Rng(deriveSeed(galaxyRoot(0x53474141n), 'nucleus'));

  // Black hole against bulge. A classical bulge follows the tight
  // power law; a pseudobulge sits an order of magnitude below it with
  // much weaker correlation — bar-driven inflow builds a bulge far
  // faster than it feeds a hole.
  const bulge = spheroid.massSolar;
  const massSolar =
    spheroid.kind === 'classical'
      ? 0.49e9 * (bulge / 1e11) ** 1.16 * 10 ** rng.normal(0, 0.29)
      : bulge * 10 ** rng.normal(-3.5, 0.55);

  // Spin. Coherent accretion spins a hole up toward the Thorne limit;
  // mergers and chaotically oriented episodes leave it slow. The
  // observed population leans high.
  const spin = clampSpin(0.998 * rng.float() ** 0.45);

  const gravitationalRadiusM = gravitationalRadius(massSolar);
  const iscoRg = iscoRadiusRg(spin);

  // How hard it is feeding. The duty cycle of luminous accretion is a
  // few percent, so the draw is crushed toward the quiescent floor and
  // only occasionally reaches out to a quasar.
  const eddingtonRatio = 10 ** (-9 + 8.5 * rng.float() ** 3);

  const sigma = spheroid.dispersionKmS * 1000;
  const influenceRadiusPc =
    (G * massSolar * SOLAR_MASS) / (sigma * sigma) / PARSEC;
  // Kepler at the ISCO, in the Boyer–Lindquist sense a distant clock
  // reads: Ω = c³/[GM(r^{3/2} + a)].
  const iscoPeriodS =
    ((2 * Math.PI * gravitationalRadiusM) / C_LIGHT) * (iscoRg ** 1.5 + spin);

  // Loose alignment with the disk: the gas that spun the hole up came
  // from the disk, but the inflow wanders and the last episode
  // decided the axis.
  const tilt = Math.acos(1 - 0.55 * rng.float());
  const azimuth = rng.range(0, 2 * Math.PI);

  memo = {
    massSolar,
    spin,
    gravitationalRadiusM,
    horizonRadiusM: horizonRadiusRg(spin) * gravitationalRadiusM,
    photonSphereRadiusM: photonSphereRadiusRg(spin) * gravitationalRadiusM,
    iscoRadiusM: iscoRg * gravitationalRadiusM,
    shadowRadiusM: shadowImpactParameterRg() * gravitationalRadiusM,
    influenceRadiusPc,
    iscoPeriodS,
    spinAxisGalactic: [
      Math.sin(tilt) * Math.cos(azimuth),
      Math.sin(tilt) * Math.sin(azimuth),
      Math.cos(tilt),
    ],
    hawkingTemperatureK: hawkingTemperature(massSolar),
    cluster: nuclearStarCluster(),
    flow: accretionFlowFor(massSolar, spin, eddingtonRatio),
  };
  return memo;
}
