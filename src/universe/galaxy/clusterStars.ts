import { buildTemperatureLut, temperatureToLutCoord } from '../../core/color/blackbody';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { evolve } from '../star/evolution';
import { KROUPA_SEGMENTS, massUnitForMass } from '../star/imf';
import { galaxyRoot } from './galaxySeed';
import { nuclearStarCluster } from './spheroid';
import { meanStellarMass } from './stellarMass';

/**
 * The nuclear star cluster as a sky to stand inside: tens of millions
 * of stars within a few parsecs, of which the ones worth drawing are
 * the ones bright enough to be picked out.
 *
 * So the cluster is surveyed the way the star catalog surveys the disk
 * — down to a depth, not by a quota. Its luminosity function is built
 * from the initial mass function crossed with the two epochs the
 * centre holds, an ancient bulk and a young disc that star formation
 * reaches in bursts; the cut falls where the count of stars above it
 * matches what can be drawn, and every point past that is one real
 * star with its own mass, age, luminosity and colour. The rest — the
 * overwhelming majority by number, carrying the remainder of the light
 * — stays unresolved, which is what a cluster's glow is.
 */
export interface ClusterStars {
  /** Galactic-frame positions relative to the centre, pc. */
  positionsPc: Float32Array;
  /** Linear sRGB hue per star. */
  colors: Float32Array;
  /** Solar luminosities, each star's own. */
  luminosities: Float32Array;
  /** Total cluster luminosity, L☉, resolved and unresolved together. */
  totalLuminosity: number;
  /** Faintest star drawn, L☉ — the survey depth. */
  cutLuminosity: number;
  /** Share of the cluster's light standing in the drawn stars. */
  resolvedFraction: number;
}

/**
 * How many of the cluster's stars are drawn. Standing inside it, every
 * one of these is nearer than a parsec or two and the sky-point
 * material saturates on most of them, so more points past this buy a
 * whiter sky rather than a richer one — and they are paid for on every
 * frame and every face of the sky capture.
 */
const POINT_COUNT = 18000;
/** The young nuclear disc: a small fraction by number, most of the
 *  ultraviolet, and gathered far tighter than the ancient bulk —
 *  star formation reaches the centre in bursts and close in. */
const YOUNG_FRACTION = 0.07;
const YOUNG_RADIUS_PC = 0.6;
/**
 * Where the cluster ends, in scale radii. A Hernquist sphere has no
 * edge — sampled to its tail it puts members tens of kiloparsecs out,
 * which is not a cluster but a spray across the galaxy. Real nuclear
 * clusters do end, at tens of parsecs, where the surrounding bulge
 * takes the stars over.
 */
const TRUNCATION = 12;

interface Member {
  /** Representative luminosity, for ranking the survey by depth. */
  luminosity: number;
  /** Share of the cluster's stars in this bin. */
  weight: number;
  massLow: number;
  massHigh: number;
  ageLow: number;
  ageSpan: number;
  young: boolean;
}

let cached: ClusterStars | null = null;

export function nuclearClusterStars(): ClusterStars {
  if (cached) return cached;
  const cluster = nuclearStarCluster();
  const rng = new Rng(deriveSeed(galaxyRoot(0x4e534331n), 'cluster-stars'));
  const lut = buildTemperatureLut(96);

  const starCount = cluster.massSolar / meanStellarMass();
  const members = population();
  let totalLuminosity = 0;
  for (const m of members) totalLuminosity += m.weight * m.luminosity;
  totalLuminosity *= starCount;

  // Survey depth: brightest first until the count of stars that bright
  // fills the points there are to draw. The bin the budget runs out in
  // is taken in part rather than skipped — whole bins hold thousands of
  // stars each, and dropping one would leave the survey far short.
  members.sort((a, b) => b.luminosity - a.luminosity);
  const drawn: Member[] = [];
  let counted = 0;
  let resolvedLight = 0;
  for (const member of members) {
    const inBin = member.weight * starCount;
    const take = Math.min(inBin, POINT_COUNT - counted);
    if (take <= 0) break;
    drawn.push(take < inBin ? { ...member, weight: member.weight * (take / inBin) } : member);
    counted += take;
    resolvedLight += take * member.luminosity;
  }
  const cutLuminosity = drawn[drawn.length - 1].luminosity;

  // One draw picks a star from the surveyed population by number.
  const cdf = new Float64Array(drawn.length);
  let running = 0;
  for (let i = 0; i < drawn.length; i++) {
    running += drawn[i].weight;
    cdf[i] = running;
  }

  const count = Math.min(POINT_COUNT, Math.max(1, Math.round(counted)));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const luminosities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const cell = drawn[pick(cdf, rng.float() * running)];
    // The cell is a bin, not a star: draw a mass and an age from
    // inside it and evolve those, or every star in the bin would come
    // out identical and the sky would band into a few brightnesses.
    const mass = cell.massLow * (cell.massHigh / cell.massLow) ** rng.float();
    const star = evolve(mass, cell.ageLow + cell.ageSpan * rng.float());
    // Hernquist mass profile inverted: M(<r)/M = r²/(r+a)², with the
    // draw renormalised to the mass inside the truncation so the
    // profile keeps its shape and simply stops.
    const scale = cell.young ? YOUNG_RADIUS_PC : cluster.scaleRadiusPc;
    const held = (TRUNCATION / (TRUNCATION + 1)) ** 2;
    const root = Math.sqrt(rng.float() * held);
    const radius = (scale * root) / (1 - root);
    const cosTheta = 2 * rng.float() - 1;
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = rng.float() * 2 * Math.PI;
    positions[i * 3] = radius * sinTheta * Math.cos(phi);
    positions[i * 3 + 1] = radius * sinTheta * Math.sin(phi);
    positions[i * 3 + 2] = radius * cosTheta;

    const index = Math.min(95, Math.floor(temperatureToLutCoord(Math.max(star.tEff, 1)) * 95)) * 4;
    colors[i * 3] = lut[index];
    colors[i * 3 + 1] = lut[index + 1];
    colors[i * 3 + 2] = lut[index + 2];
    luminosities[i] = Math.max(star.luminosity, 0);
  }

  cached = {
    positionsPc: positions,
    colors,
    luminosities,
    totalLuminosity,
    cutLuminosity,
    resolvedFraction: resolvedLight / Math.max(totalLuminosity, 1e-9),
  };
  return cached;
}

/** First index whose cumulative weight passes the target. */
function pick(cdf: Float64Array, target: number): number {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The cluster's stars as a mass × age grid: the IMF by number, crossed
 * with its two epochs, each cell evolved to what it is now.
 *
 * The mass axis is spaced logarithmically, not by equal share of the
 * population — spaced by share, a single bin would hold everything
 * from a solar mass to a hundred, and the whole bright tail the survey
 * is looking for would collapse into one number. Logarithmic bins put
 * the resolution where the luminosity range is.
 */
function population(): Member[] {
  const massBins = 220;
  const low = KROUPA_SEGMENTS[0].min;
  const high = KROUPA_SEGMENTS[KROUPA_SEGMENTS.length - 1].max;
  const epochs: Array<{ low: number; span: number; share: number; young: boolean }> = [];
  const oldBins = 12;
  const youngBins = 8;
  for (let i = 0; i < oldBins; i++) {
    epochs.push({ low: 8 + (4 * i) / oldBins, span: 4 / oldBins, share: (1 - YOUNG_FRACTION) / oldBins, young: false });
  }
  for (let i = 0; i < youngBins; i++) {
    epochs.push({ low: 0.005 + (0.1 * i) / youngBins, span: 0.1 / youngBins, share: YOUNG_FRACTION / youngBins, young: true });
  }

  const members: Member[] = [];
  for (let m = 0; m < massBins; m++) {
    const m0 = low * (high / low) ** (m / massBins);
    const m1 = low * (high / low) ** ((m + 1) / massBins);
    const share = massUnitForMass(m1) - massUnitForMass(m0);
    if (share <= 0) continue;
    const mass = Math.sqrt(m0 * m1);
    for (const epoch of epochs) {
      const star = evolve(mass, epoch.low + epoch.span * 0.5);
      if (star.luminosity <= 0 || star.tEff <= 0) continue;
      members.push({
        luminosity: star.luminosity,
        weight: share * epoch.share,
        massLow: m0,
        massHigh: m1,
        ageLow: epoch.low,
        ageSpan: epoch.span,
        young: epoch.young,
      });
    }
  }
  return members;
}
