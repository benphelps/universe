import { G, PARSEC, SOLAR_MASS } from '../../core/physics/constants';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { galaxyRoot } from './galaxySeed';
import { galaxyStellarMass } from './stellarMass';

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

export type SpheroidKind = 'classical' | 'pseudo';

export interface CentralSpheroid {
  kind: SpheroidKind;
  massSolar: number;
  /** Projected half-light radius, pc. */
  effectiveRadiusPc: number;
  /** Hernquist scale radius a = R_e/1.8153, pc. */
  scaleRadiusPc: number;
  /** One-dimensional stellar velocity dispersion, km/s. */
  dispersionKmS: number;
}

/** The nuclear star cluster: the densest stellar structure anywhere in
 *  the galaxy, a few parsecs across and wrapped around the hole. */
export interface NuclearStarCluster {
  massSolar: number;
  /** Projected half-light radius, pc — NSC sizes barely grow with mass. */
  effectiveRadiusPc: number;
  scaleRadiusPc: number;
  /** Mean stellar number density inside the half-light radius, per pc³. */
  coreDensityPerPc3: number;
}

/** The nuclear cluster is ancient: its light is dominated by evolved
 *  stars, and its mean member mass is the old-population value. */
const MEAN_CLUSTER_STAR_MASS = 0.3;

/** Hernquist half-mass radius in units of the scale radius. */
const HERNQUIST_HALF_MASS = 1 + Math.SQRT2;
/** Projected half-light radius in units of the scale radius. */
const HERNQUIST_EFFECTIVE = 1.8153;

let spheroidMemo: CentralSpheroid | null = null;
let clusterMemo: NuclearStarCluster | null = null;

/**
 * The galaxy's bulge. Its mass is a fraction of the galaxy's own
 * stellar mass — the bulge-to-total ratio, which for spirals runs from
 * a few percent (late types, disk-dominated) to about a third — and
 * its size follows the spheroid mass–size relation. The dispersion is
 * then not a free parameter at all: the virial theorem for a Hernquist
 * sphere fixes σ² = GM/18a exactly.
 */
export function centralSpheroid(): CentralSpheroid {
  if (spheroidMemo) return spheroidMemo;
  const rng = new Rng(deriveSeed(galaxyRoot(0x42554c4745n), 'spheroid'));
  // Pseudobulges dominate the late-type spirals this density model
  // describes; classical bulges need a major merger in the past.
  const kind: SpheroidKind = rng.float() < 0.62 ? 'pseudo' : 'classical';
  // Log-uniform bulge-to-total. Pseudobulges stay under a quarter of
  // the galaxy — that ceiling is part of what defines them; classical
  // bulges run from there up to the early-type spiral range.
  const ratio =
    kind === 'pseudo' ? 0.05 * 5 ** rng.float() : 0.12 * (0.42 / 0.12) ** rng.float();
  const massSolar = ratio * galaxyStellarMass();
  // Spheroid mass–size relation, anchored near a kiloparsec at 10¹⁰ M☉.
  const effectiveRadiusPc = 900 * (massSolar / 1e10) ** 0.55 * rng.range(0.75, 1.35);
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
  const rng = new Rng(deriveSeed(galaxyRoot(0x4e5343n), 'nuclear-cluster'));
  const massSolar = galaxyStellarMass() * 10 ** rng.normal(-3.3, 0.3);
  const effectiveRadiusPc = 4.0 * (massSolar / 1e7) ** 0.35 * rng.range(0.7, 1.4);
  const scaleRadiusPc = effectiveRadiusPc / HERNQUIST_EFFECTIVE;
  // Half the mass sits inside the half-mass radius, by definition.
  const halfMassPc = HERNQUIST_HALF_MASS * scaleRadiusPc;
  const coreDensityPerPc3 =
    (0.5 * massSolar) / ((4 / 3) * Math.PI * halfMassPc ** 3) / MEAN_CLUSTER_STAR_MASS;
  clusterMemo = { massSolar, effectiveRadiusPc, scaleRadiusPc, coreDensityPerPc3 };
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
