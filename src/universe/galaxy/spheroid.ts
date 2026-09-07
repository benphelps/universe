import { G, PARSEC, SOLAR_MASS } from '../../core/physics/constants';
import { galaxyStellarMass, galaxyBulgeStarCount } from './stellarMass';
import { spheroidParameters, nuclearClusterParameters, type SpheroidKind } from './spheroidParameters';
import { nuclearHalfMassRadius, nuclearMeanStellarMass, nuclearEnclosedFraction, NUCLEAR_EPOCHS } from './nuclearPopulation';
export type { SpheroidKind } from './spheroidParameters';

/**
 * The galaxy's central spheroid and the star cluster at its heart —
 * the two stellar structures the disk model does not describe, and the
 * ones everything about the nucleus follows from.
 *
 * A spiral's bulge comes in two kinds, and which kind it is decides
 * how big a black hole it can grow (see nucleus.ts): a **classical**
 * bulge is a merger remnant, pressure-supported and old, and tracks
 * the black-hole mass tightly; a **pseudobulge** is disk material the
 * bar herded inward, still rotating, and hosts a markedly undermassive
 * hole with far weaker correlation. Late-type spirals are mostly
 * pseudobulges — the Milky Way among them.
 */

export interface CentralSpheroid {
  kind: SpheroidKind;
  massSolar: number;
  /** Projected half-light radius, pc. */
  effectiveRadiusPc: number;
  /** Hernquist scale radius a = R_e/1.8153, pc. */
  scaleRadiusPc: number;
  /** Nominal Hernquist one-dimensional velocity dispersion, km/s. */
  dispersionKmS: number;
}

/** The nuclear star cluster: the densest stellar structure anywhere in
 *  the galaxy, a few parsecs across and wrapped around the hole. */
export interface NuclearStarCluster {
  massSolar: number;
  /** Reference projected radius of the untruncated old component, pc.
   * The finite old/young mixture need not have this half-light radius. */
  effectiveRadiusPc: number;
  scaleRadiusPc: number;
  halfMassRadiusPc: number;
  /** Mean stellar number density inside the 3D half-mass radius, per pc³. */
  coreDensityPerPc3: number;
}

/** Projected half-light radius in units of the scale radius. */
const HERNQUIST_EFFECTIVE = 1.8153;

let spheroidMemo: CentralSpheroid | null = null;
let clusterMemo: NuclearStarCluster | null = null;

/**
 * The galaxy's bulge. Its mass is a fraction of the galaxy's own
 * stellar mass — the bulge-to-total ratio, which for spirals runs from
 * a few percent (late types, disk-dominated) to about a third — and
 * its size follows the spheroid mass–size relation. The nominal
 * dispersion uses σ² = GM/18a for an isolated Hernquist sphere;
 * the finite catalogue core, nuclear cluster and rotation would need
 * a separate dynamical solution for a self-consistent dispersion.
 */
export function centralSpheroid(): CentralSpheroid {
  if (spheroidMemo) return spheroidMemo;
  const { kind, massFraction, sizeScatter } = spheroidParameters();
  const massSolar = massFraction * galaxyStellarMass();
  // Spheroid mass–size relation, anchored near a kiloparsec at 10¹⁰ M☉.
  const effectiveRadiusPc = 900 * (massSolar / 1e10) ** 0.55 * sizeScatter;
  const scaleRadiusPc = effectiveRadiusPc / HERNQUIST_EFFECTIVE;
  // Hernquist virial: W = −GM²/6a, so ⟨v²⟩ = GM/6a and σ₁D² = GM/18a.
  const dispersionKmS =
    Math.sqrt((G * massSolar * SOLAR_MASS) / (18 * scaleRadiusPc * PARSEC)) / 1000;
  spheroidMemo = { kind, massSolar, effectiveRadiusPc, scaleRadiusPc, dispersionKmS };
  return spheroidMemo;
}

/**
 * The nuclear star cluster. Nucleation is near-universal in this mass
 * range and the cluster's mass tracks the host's at a few parts in ten
 * thousand; its radius barely moves with mass — a few parsecs whether
 * the cluster is 10⁶ or 10⁸ M☉ — which is exactly why the centre is so
 * extraordinarily dense.
 */
export function nuclearStarCluster(): NuclearStarCluster {
  if (clusterMemo) return clusterMemo;
  const { massFraction, sizeScatter } = nuclearClusterParameters();
  const massSolar = galaxyStellarMass() * massFraction;
  const effectiveRadiusPc = 4.0 * (massSolar / 1e7) ** 0.35 * sizeScatter;
  const scaleRadiusPc = effectiveRadiusPc / HERNQUIST_EFFECTIVE;
  // Half the mass sits inside the half-mass radius, by definition.
  const halfMassPc = nuclearHalfMassRadius(scaleRadiusPc);
  // Number and mass have different radial weights because young stars
  // have a different present-day mean mass; use their enclosed counts.
  const heldCount = massSolar / nuclearMeanStellarMass() * NUCLEAR_EPOCHS.reduce((sum, epoch) =>
    sum + epoch.numberShare * nuclearEnclosedFraction(halfMassPc, epoch.scalePc ?? scaleRadiusPc), 0);
  const coreDensityPerPc3 = heldCount / ((4 / 3) * Math.PI * halfMassPc ** 3);
  clusterMemo = { massSolar, effectiveRadiusPc, scaleRadiusPc, halfMassRadiusPc: halfMassPc, coreDensityPerPc3 };
  return clusterMemo;
}

/** Enclosed stellar mass of a Hernquist sphere inside radius r, M☉. */
export function hernquistMassWithin(
  radiusPc: number,
  totalSolar: number,
  scaleRadiusPc: number,
): number {
  const x = radiusPc / (radiusPc + scaleRadiusPc);
  return totalSolar * x * x;
}

/** Finite-resolution Hernquist number density for the field catalogue
 * and unresolved light. A quartic core replaces the unresolved cusp,
 * matching its density, slope AND enclosed mass at 0.1a. All exterior
 * enclosed masses and the projected half-light radius are unchanged.
 * The nuclear cluster has its own allocated population and renderer. */
export interface BulgeDensityModel {
  scalePc: number;
  corePc: number;
  coefficient: number;
  corePolynomial: [number, number, number];
}
let bulgeModelMemo: BulgeDensityModel | null = null;
export function bulgeDensityModel(): BulgeDensityModel {
  if (bulgeModelMemo) return bulgeModelMemo;
  const scalePc = centralSpheroid().scaleRadiusPc;
  const corePc = 0.1 * scalePc;
  const count = galaxyBulgeStarCount();
  const coefficient = count * scalePc / (2 * Math.PI);
  const boundary = coefficient / (corePc * (corePc + scalePc) ** 3);
  const mean = 3 * count / (4 * Math.PI * corePc * (corePc + scalePc) ** 2);
  const slope = -boundary * (1 + 3 * corePc / (corePc + scalePc));
  const c = (35 * (mean - boundary) + 7 * slope) / 8;
  const b = slope / 2 - 2 * c;
  const a = boundary - b - c;
  return bulgeModelMemo = { scalePc, corePc, coefficient, corePolynomial: [a, b, c] };
}

export function bulgeDensity(radiusPc: number): number {
  const { scalePc, corePc, coefficient, corePolynomial: [a, b, c] } = bulgeDensityModel();
  if (radiusPc < corePc) {
    const t2 = (radiusPc / corePc) ** 2;
    return (c * t2 + b) * t2 + a;
  }
  return coefficient / (radiusPc * (radiusPc + scalePc) ** 3);
}
