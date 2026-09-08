import { opticalRgbInterpolator, rgbLuminance } from '../../core/color/optical';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { galaxyRoot } from './galaxySeed';
import { nuclearStarCluster } from './spheroid';
import { galaxyNuclearStarCount } from './stellarMass';
import { populationMoments } from './populationMoments';
import { visitPopulationSamples } from './populationQuadrature';
import { nuclearMassBounds } from './nuclearMassBounds';
import { NUCLEAR_EPOCHS } from './nuclearPopulation';
import { nuclearProfileRadius, nuclearColumnTable, type NuclearColumnTable } from './nuclearProfile';

export interface NuclearLightBudget {
  starCount: number;
  massSolar: number;
  resolvedStars: number;
  resolvedMassSolar: number;
  unresolvedMassSolar: number;
  /** Ensemble averages, distinct from this finite bright-star realization. */
  expectedLuminosity: number;
  expectedOpticalRgb: [number, number, number];
  expectedResolvedStars: number;
  expectedResolvedLuminosity: number;
  expectedResolvedOpticalRgb: [number, number, number];
  totalLuminosity: number;
  resolvedLuminosity: number;
  unresolvedLuminosity: number;
  totalOpticalRgb: [number, number, number];
  resolvedOpticalRgb: [number, number, number];
  unresolvedOpticalRgb: [number, number, number];
}
export interface ClusterStars {
  column: NuclearColumnTable;
  positionsPc: Float32Array;
  /** Unit-luminance optical RGB hue, never peak normalized. */
  colors: Float32Array;
  /** Actual bolometric luminosities of the drawn physical samples. */
  luminosities: Float32Array;
  opticalLuminosities: Float32Array;
  initialMasses: Float64Array;
  agesGyr: Float64Array;
  epochIndices: Uint8Array;
  totalLuminosity: number;
  /** Minimum bolometric luminosity actually drawn (not the survey cut). */
  cutLuminosity: number;
  /** Brightest-first optical survey cutoff, L☉ in 380–780 nm. */
  cutOpticalLuminosity: number;
  /** Actual drawn bolometric power / cluster bolometric power. */
  resolvedFraction: number;
  epochs: NuclearLightBudget[];
}

/** Bounded bright-to-faint realization, shared by the native cluster
 * and its cached lensed sky. Fainter light is debited from the smooth
 * population below; increasing detail must not add stellar luminosity. */
export const NUCLEAR_POINT_COUNT = 196608;
/** The bright tail is represented by phase-aware quadrature nodes.
 * These are physical (mass, age) samples, not mass/age rectangles to
 * jitter across a giant/remnant transition. Refinement tests compare
 * this discrete luminosity function with the population integral. */
export const NUCLEAR_MASS_BINS = 256;
const MIN_OPTICAL_LUMINOSITY = 1;
interface Member {
  weight: number;
  luminosity: number;
  optical: number;
  color: [number, number, number];
  initialMass: number;
  currentMass: number;
  age: number;
  epoch: number;
}

/** Uncached: runs in the nuclear worker in production. */
export function buildNuclearClusterStars(massBins = NUCLEAR_MASS_BINS, quadratureOrder: 2 | 4 | 8 = 2, pointLimit = NUCLEAR_POINT_COUNT): ClusterStars {
  const cluster = nuclearStarCluster(), starCount = galaxyNuclearStarCount();
  const limit = Math.min(NUCLEAR_POINT_COUNT, Math.max(0, Math.floor(pointLimit)));
  const rng = new Rng(deriveSeed(galaxyRoot(0x4e534331n), 'cluster-stars'));
  const opticalRgb = opticalRgbInterpolator();
  const members: Member[] = [];
  const epochs: NuclearLightBudget[] = NUCLEAR_EPOCHS.map((epoch, index) => {
    const count = starCount * epoch.numberShare, moments = populationMoments(epoch.component);
    visitPopulationSamples(epoch.component, massBins, (weight, initialMass, age, star) => {
      if (star.luminosity < MIN_OPTICAL_LUMINOSITY || star.tEff <= 0) return;
      const rgb = opticalRgb(star.tEff), optical = star.luminosity * rgbLuminance(rgb);
      if (optical < MIN_OPTICAL_LUMINOSITY) return;
      const y = rgbLuminance(rgb);
      members.push({ weight: count * weight, luminosity: star.luminosity, optical,
        color: [rgb[0] / y, rgb[1] / y, rgb[2] / y], initialMass, currentMass: star.mass, age, epoch: index });
    // Old giant curves need four nodes per interval; the densely split
    // young reference tracks converge with two and dominate sample cost.
    }, massBins === NUCLEAR_MASS_BINS ? nuclearMassBounds[index] : undefined, index === 0 && quadratureOrder === 2 ? 4 : quadratureOrder);
    return { starCount: count, massSolar: count * moments.massSolar, resolvedStars: 0, resolvedMassSolar: 0, unresolvedMassSolar: 0,
      expectedLuminosity: count * moments.luminositySolar,
      expectedOpticalRgb: moments.opticalRgbSolar.map(v => v * count) as [number, number, number],
      expectedResolvedStars: 0, expectedResolvedLuminosity: 0, expectedResolvedOpticalRgb: [0, 0, 0],
      totalLuminosity: count * moments.luminositySolar, resolvedLuminosity: 0, unresolvedLuminosity: 0,
      totalOpticalRgb: moments.opticalRgbSolar.map(v => v * count) as [number, number, number],
      resolvedOpticalRgb: [0, 0, 0], unresolvedOpticalRgb: [0, 0, 0] };
  });
  members.sort((a, b) => b.optical - a.optical);
  const drawn: Member[] = [], cdf: number[] = [];
  let represented = 0;
  for (const member of members) {
    const take = Math.min(member.weight, limit - represented);
    if (take <= 0) break;
    const epoch = epochs[member.epoch];
    epoch.expectedResolvedStars += take;
    epoch.expectedResolvedLuminosity += take * member.luminosity;
    for (let c = 0; c < 3; c++) epoch.expectedResolvedOpticalRgb[c] += take * member.optical * member.color[c];
    drawn.push(member); represented += take; cdf.push(represented);
  }
  const count = Math.floor(represented);
  const positionsPc = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const luminosities = new Float32Array(count), opticalLuminosities = new Float32Array(count);
  const initialMasses = new Float64Array(count), agesGyr = new Float64Array(count), epochIndices = new Uint8Array(count);
  let cutLuminosity = Infinity;
  // Stratify the sorted luminosity CDF: rare bright bins are sampled
  // without the large aggregate fluctuations of independent draws.
  for (let i = 0; i < count; i++) {
    // One expected star per CDF stratum. Increasing the budget appends
    // fainter stars without moving or changing the existing bright ones.
    const target = i + rng.float();
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (cdf[mid] < target) lo = mid + 1; else hi = mid; }
    const member = drawn[lo], budget = epochs[member.epoch];
    const scale = NUCLEAR_EPOCHS[member.epoch].scalePc ?? cluster.scaleRadiusPc;
    const radius = scale * nuclearProfileRadius(rng.float());
    const z = 2 * rng.float() - 1, r = Math.sqrt(Math.max(0, 1 - z * z)), phi = 2 * Math.PI * rng.float();
    positionsPc[i * 3] = radius * r * Math.cos(phi); positionsPc[i * 3 + 1] = radius * r * Math.sin(phi); positionsPc[i * 3 + 2] = radius * z;
    luminosities[i] = member.luminosity; opticalLuminosities[i] = member.optical;
    initialMasses[i] = member.initialMass; agesGyr[i] = member.age; epochIndices[i] = member.epoch;
    for (let c = 0; c < 3; c++) {
      colors[i * 3 + c] = member.color[c];
      budget.resolvedOpticalRgb[c] += opticalLuminosities[i] * colors[i * 3 + c];
    }
    budget.resolvedLuminosity += luminosities[i];
    budget.resolvedMassSolar += member.currentMass; budget.resolvedStars++;
    cutLuminosity = Math.min(cutLuminosity, luminosities[i]);
  }
  // Replace the ensemble's bright tail with its actual finite realization.
  // Subtracting actual giant light from an ensemble mean can make the faint
  // remainder negative: rare stars fluctuate even with a stratified survey.
  // The remaining number stays N - actual resolved N within each epoch.
  for (const epoch of epochs) {
    const remainingCountScale = (epoch.starCount - epoch.resolvedStars) / (epoch.starCount - epoch.expectedResolvedStars);
    epoch.unresolvedLuminosity = (epoch.expectedLuminosity - epoch.expectedResolvedLuminosity) * remainingCountScale;
    epoch.totalLuminosity = epoch.resolvedLuminosity + epoch.unresolvedLuminosity;
    epoch.unresolvedMassSolar = epoch.massSolar - epoch.resolvedMassSolar;
    if (epoch.unresolvedLuminosity < 0 || epoch.unresolvedMassSolar < 0 || epoch.resolvedStars > epoch.starCount) {
      throw new Error('Nuclear point survey overdraws its population inventory');
    }
    for (let c = 0; c < 3; c++) {
      epoch.unresolvedOpticalRgb[c] = (epoch.expectedOpticalRgb[c] - epoch.expectedResolvedOpticalRgb[c]) * remainingCountScale;
      epoch.totalOpticalRgb[c] = epoch.resolvedOpticalRgb[c] + epoch.unresolvedOpticalRgb[c];
      if (epoch.unresolvedOpticalRgb[c] < 0) throw new Error('Nuclear point survey overdraws its optical population budget');
    }
  }
  const totalLuminosity = epochs.reduce((sum, e) => sum + e.totalLuminosity, 0);
  return { column: nuclearColumnTable(), positionsPc, colors, luminosities, opticalLuminosities, initialMasses, agesGyr, epochIndices,
    totalLuminosity, cutLuminosity: count ? cutLuminosity : 0,
    cutOpticalLuminosity: drawn.at(-1)?.optical ?? 0,
    resolvedFraction: epochs.reduce((sum, e) => sum + e.resolvedLuminosity, 0) / totalLuminosity, epochs };
}

let cached: ClusterStars | null = null;
export function nuclearClusterStars(): ClusterStars { return cached ??= buildNuclearClusterStars(); }
