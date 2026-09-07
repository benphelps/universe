import {
  ERG_PER_SOLAR_LUMINOSITY,
} from '../../core/physics/constants';
import type { LinearRgb } from '../../core/color/srgb';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import {
  cloudCarveDustScale,
  cloudDustFactor,
  cloudFineDensity,
  cloudHalfExtentsPc,
  type MolecularCloud,
} from './clouds';
import { DUST_ALBEDO, DUST_OPACITY_PER_PC } from './density';
import { hydrogenDensity } from './gas';
import { hydrogenBetaLuminosity, RECOMBINATION_SCALE } from './ionization';
import { MEMBER_SPREAD, nebulaGrowth, nebulaIlluminant, type Nebula } from './nebula';
import { ismMetallicity } from './population';
import { nebulaEmissionColor, nebulaLineSum, nebulaNarrowbandColor } from './nebulaLines';
import { nebulaPhotonAccounting, type NebulaPhotonAccounting } from './nebulaAccounting';
import type { PhotonLedger } from './photonTransport';
import { NEBULA_FAINT_SOURCE_FRACTION, groupPhotonSources, transportMultiplePhotons, type PhotonSource } from './multiplePhotonTransport';
import { NebulaGasAccumulator, remappedGasInventory, type GasInventoryExclusion, type NebulaGasInventory } from './nebulaGasInventory';
import { remapGas, type GasGrid } from './gasRemap';
import { bakeContinuum, stellarContinuum, type ContinuumSource, type NebulaContinuum } from './nebulaContinuum';
import { feedbackMaterialMap, nebulaFeedbackProfile, type FeedbackProfile } from './nebulaFeedback';

/**
 * A nebula baked into a volume the renderer can march.
 *
 * A conservative material remap moves natal gas into an expanded
 * interior and finite-width shells. The photon solve then spends Q
 * against that gas. Mass closure does not validate the prescribed
 * expansion dynamics: momentum, energy and stellar mass exchange are
 * not evolved here. The shader integrates the baked emissivity.
 *
 * The box is the ionized region and its walls, not the cloud. A giant
 * molecular cloud is a hundred parsecs across and the bubble its
 * newborns blow is a few: gridding the whole cloud puts the entire
 * nebula inside one cell. Orion is the same arrangement — a small
 * blister on the near face of a cloud far larger than it — and the
 * cloud beyond the box is already drawn, as the dark rift it is.
 *
 * The work divides into a plan, a march, and a finish, because the
 * natal field has CPU and GPU evaluators. Both use the same material
 * remap, final-dust attenuation, equilibrium solve and encoding.
 */
export interface NebulaVolumeBake {
  seed: bigint;
  /** Cells per axis. */
  size: number;
  /** Box centre in galactic pc; nested bakes snap to coarse cell faces. */
  centrePc: [number, number, number];
  /** Half-extents of the box the grid covers, pc. */
  halfExtentsPc: [number, number, number];
  /**
   * RGBA per cell: sqrt dust, ionized-density high byte, hardness,
   * ionized-density low byte. Resolved continuum has its own field.
   * The two density bytes preserve faint emission without extra memory.
   */
  data: Uint8Array;
  /** Resolved optical source field; separate from ionizing photons. */
  continuum?: NebulaContinuum;
  /** Which blocks of the grid hold anything at all, OCCUPANCY_SIZE per
   *  axis, 255 or 0: a march skips an empty block in one step instead
   *  of sampling its way across it. A block counts as occupied if any
   *  cell a trilinear read inside it could touch is non-zero, so the
   *  skip is exact, not approximate. */
  occupancy: Uint8Array;
  /** Dust density that R = 255 stands for. R holds the square root of
   *  the fraction: the clump peaks the reference is taken from stand
   *  orders of magnitude over the diffuse dust a sightline mostly
   *  crosses, and a linear byte zeroes nearly every dusty cell — the
   *  extinction a star behind the cloud actually suffers. */
  dustRef: number;
  /**
   * Emission coefficient: L☉ per parsec³ per steradian per cm⁻⁶ of
   * emission measure. Uses the case-B recombination coefficient and
   * line mixture; it never renormalizes the gas to the full source Q.
   */
  emissionCoefficient: number;
  /** Hot endpoint; interpolate emissivity, not a volume-mean strength. */
  emissionHotCoefficient: number;
  /** Physical demand and encoding error, independent of display normalization. */
  photonAccounting: NebulaPhotonAccounting;
  /** Shared source budget for this coarse bake and its matching fine bake. */
  compositePhotonLedger?: PhotonLedger;
  /** Same-region natal/prescribed inventory. A paired coarse bake omits
   * its covered cells; the composite adds its fine partner once.
   * Transport inventories include measured boundary exchange; mass
   * closure alone does not validate the prescribed dynamics. */
  gasInventory?: NebulaGasInventory;
  compositeGasInventory?: NebulaGasInventory;
  /** Hydrogen density that G = 255 stands for, cm⁻³. */
  densityRef: number;
  /** Where the box sits in the cloud's own frame, pc. */
  originPc: [number, number, number];
  /** Emission colour at full hardness and at none, linear RGB. */
  emissionHot: LinearRgb;
  emissionCool: LinearRgb;
  /** The same endpoints through the mapped-narrowband palette, so an
   *  instrument switch is a uniform swap, never a re-bake. */
  emissionHotNarrow: LinearRgb;
  emissionCoolNarrow: LinearRgb;
  /** The source's own light, for what the dust scatters. */
  reflectionColor: LinearRgb;
  /** Where what shines on the dust stands, box frame, pc: the ionizing
   *  star when there is one, else the group's brightest member — the
   *  A-channel transmittance rays radiate from here. */
  scatterSourcePc: [number, number, number];
  /** What the group shines on the dust from there, L☉. Zero leaves
   *  the dust dark: a rift with no stars scatters nothing. */
  scatterLuminositySolar: number;
  /** Floor on r², pc²: the group is not a point but a cluster spread
   *  over parsecs, and inside that spread the flux flattens instead of
   *  diverging on whichever cell holds the brightest member. */
  scatterFloorPc2: number;
}

/** Scattered emissivity per L☉ per unit dust at unit distance,
 *  L☉ pc⁻³ sr⁻¹: the flux L/(4πr²) times the dust's opacity per
 *  parsec, times albedo over the 4π sr it rescatters into. The
 *  angular dependence comes from the resolved continuum's normalized
 *  HG moment closure. This is first-order scattering only. */
export const SCATTER_EMISSIVITY_PER_LSUN = (DUST_OPACITY_PER_PC * DUST_ALBEDO) / (16 * Math.PI ** 2);

/** Trilinear read of a scalar grid, clamped at the edges. */
function sample(grid: Float32Array, size: number, x: number, y: number, z: number): number {
  const cx = Math.min(size - 1.001, Math.max(0, x));
  const cy = Math.min(size - 1.001, Math.max(0, y));
  const cz = Math.min(size - 1.001, Math.max(0, z));
  const i = Math.floor(cx);
  const j = Math.floor(cy);
  const k = Math.floor(cz);
  const fx = cx - i;
  const fy = cy - j;
  const fz = cz - k;
  const a = (k * size + j) * size + i, b = a + size, c = a + size * size, d = c + size;
  const x00 = grid[a] + (grid[a + 1] - grid[a]) * fx;
  const x10 = grid[b] + (grid[b + 1] - grid[b]) * fx;
  const x01 = grid[c] + (grid[c + 1] - grid[c]) * fx;
  const x11 = grid[d] + (grid[d + 1] - grid[d]) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** Blocks per axis of a bake's occupancy grid. A cloud-sized box is
 *  mostly void — the carve fills a few percent of it — and the march's
 *  cost is in the samples it takes there. */
export const OCCUPANCY_SIZE = 32;

/**
 * Which blocks a march has to sample: any block holding a non-zero
 * cell, and any block whose boundary layer a non-zero cell sits on
 * from the far side — the cells a trilinear read just inside the
 * block can reach. Exact for the grid as quantized.
 */
export function bakeOccupancy(data: Uint8Array, size: number): Uint8Array {
  const occupancy = new Uint8Array(OCCUPANCY_SIZE ** 3);
  const blockOf = (cell: number): number => Math.floor((cell * OCCUPANCY_SIZE) / size);
  const mark = (bi: number, bj: number, bk: number): void => {
    if (bi < 0 || bj < 0 || bk < 0) return;
    if (bi >= OCCUPANCY_SIZE || bj >= OCCUPANCY_SIZE || bk >= OCCUPANCY_SIZE) return;
    occupancy[(bk * OCCUPANCY_SIZE + bj) * OCCUPANCY_SIZE + bi] = 255;
  };
  for (let k = 0; k < size; k++) {
    const bk = blockOf(k);
    const bkLow = k > 0 ? blockOf(k - 1) : bk;
    const bkHigh = k < size - 1 ? blockOf(k + 1) : bk;
    for (let j = 0; j < size; j++) {
      const bj = blockOf(j);
      const bjLow = j > 0 ? blockOf(j - 1) : bj;
      const bjHigh = j < size - 1 ? blockOf(j + 1) : bj;
      for (let i = 0; i < size; i++) {
        const at = ((k * size + j) * size + i) * 4;
        if (data[at] === 0 && data[at + 1] === 0 && data[at + 3] === 0) continue;
        const bi = blockOf(i);
        const biLow = i > 0 ? blockOf(i - 1) : bi;
        const biHigh = i < size - 1 ? blockOf(i + 1) : bi;
        for (const x of biLow === biHigh ? [bi] : [biLow, bi, biHigh]) {
          for (const y of bjLow === bjHigh ? [bj] : [bjLow, bj, bjHigh]) {
            for (const z of bkLow === bkHigh ? [bk] : [bkLow, bk, bkHigh]) mark(x, y, z);
          }
        }
      }
    }
  }
  return occupancy;
}

/**
 * The occupancy a march through both of a volume's grids needs: the
 * cloud-scale grid's own, with every block the bubble-scale grid holds
 * gas in marked as well — inside the bubble box the march reads that
 * grid, which resolves filaments and the diluted interior the coarse
 * cells quantize to nothing, and a block skipped on the coarse grid's
 * word would take the fine grid's gas with it in rectangular chunks.
 * The fine box sits inside the coarse one, so each occupied fine block
 * marks the coarse blocks its extent overlaps.
 */
export function combinedOccupancy(coarse: NebulaVolumeBake, fine: NebulaVolumeBake): Uint8Array {
  const occupancy = Uint8Array.from(coarse.occupancy);
  const coarseHalf = coarse.halfExtentsPc[0];
  const fineHalf = fine.halfExtentsPc[0];
  const fineBlockPc = (2 * fineHalf) / OCCUPANCY_SIZE;
  const toCoarseBlock = (pc: number): number =>
    Math.min(
      OCCUPANCY_SIZE - 1,
      Math.max(0, Math.floor(((pc + coarseHalf) / (2 * coarseHalf)) * OCCUPANCY_SIZE)),
    );
  for (let k = 0; k < OCCUPANCY_SIZE; k++) {
    for (let j = 0; j < OCCUPANCY_SIZE; j++) {
      for (let i = 0; i < OCCUPANCY_SIZE; i++) {
        if (fine.occupancy[(k * OCCUPANCY_SIZE + j) * OCCUPANCY_SIZE + i] === 0) continue;
        // The fine block's extent, in the coarse box's frame.
        const lo = [i, j, k].map(
          (b, axis) => fine.centrePc[axis] - coarse.centrePc[axis] - fineHalf + b * fineBlockPc,
        );
        const from = lo.map(toCoarseBlock);
        const to = lo.map((v) => toCoarseBlock(v + fineBlockPc));
        for (let z = from[2]; z <= to[2]; z++) {
          for (let y = from[1]; y <= to[1]; y++) {
            for (let x = from[0]; x <= to[0]; x++) {
              occupancy[(z * OCCUPANCY_SIZE + y) * OCCUPANCY_SIZE + x] = 255;
            }
          }
        }
      }
    }
  }
  return occupancy;
}

/** How much of the neutral wall around the ionized region the box
 *  keeps: enough to see the cavity it is carving out of. */
const BOX_STROMGREN_RADII = 4;
/** Even an unlit cocoon gets a body worth looking at. */
const BOX_MIN_PC = 5;

/** Whether the bubble deserves a bake of its own, or the cloud-scale
 *  grid already resolves it: the two-scale split exists for compact
 *  regions, and an evolved bubble tens of parsecs across is not one. */
export function bubbleNeedsOwnBake(nebula: Nebula, reachPc: number): boolean {
  return nebula.photonRate > 0 && BOX_STROMGREN_RADII * nebula.bubbleRadiusPc < reachPc * 0.75;
}

/**
 * Everything both marches need, worked out once from the nebula: the
 * box, source positions, expansion profile and interior dilution.
 */
export interface NebulaBakePlan {
  /** Individual sources in the cloud frame, before grid grouping. */
  continuumSources?: ContinuumSource[];
  radiationSources?: { positionPc: [number, number, number]; photonRate: number }[];
  feedbackProfile?: FeedbackProfile;
  /** Covered coarse cells are omitted from the disjoint mass inventory. */
  inventoryExclusion?: GasInventoryExclusion;
  cloud: MolecularCloud;
  metallicity: number;
  size: number;
  boxPc: number;
  /** Cell edge, pc — the box is a cube. */
  cellPc: number;
  originPc: [number, number, number];
  /** Where the ionizing budget radiates from, box frame, pc. */
  ionizePc: [number, number, number];
  /** The group's output, photons s⁻¹ — what closes the emission
   *  books in the finish. */
  photonRate: number;
  /** Mean prescribed expansion radius, pc; the equilibrium ionization
   * front is solved separately on the remapped gas. */
  bubblePc: number;
  /** The dominant source's temperature, K — the line grid's first
   *  axis, alongside the plan's metallicity and the cells' own U. */
  sourceTeff: number;
  /** Uniform-reference interior density fraction; mass reaches its
   * shell by material remapping rather than a separate density boost. */
  dilution: number;
  windCavityPc: number;
  scatterSourcePc: [number, number, number];
  scatterLuminositySolar: number;
  /** The illuminant's temperature, K, floored — the reflection hue. */
  reflectionTeff: number;
}

/** Prescribed gas/dust and solved emission fields, in physical units. */
export interface NebulaBakeFields {
  dust: Float32Array;
  /** Total prescribed gas, before the final equilibrium solve. */
  hydrogen: Float32Array;
  /** RMS density in the cell's ionized fraction, for emission measure. */
  ionized: Float32Array;
  hardness: Float32Array;
  transmittance: Float32Array;
  continuum?: NebulaContinuum;
  photonLedger?: PhotonLedger;
  gasInventory?: NebulaGasInventory;
}

/**
 * Plan a nebula's bake. `boxPc` chooses the scale: left out, the box
 * is the ionized bubble and its walls — what you look at from close
 * to. Given, it is whatever the caller wants covered, which is how the
 * cloud itself gets a volume for the view from outside.
 */
export function planNebulaBake(
  cloud: MolecularCloud,
  nebula: Nebula | null,
  size = 64,
  boxRequestPc?: number,
): NebulaBakePlan {
  const metallicity = nebula?.metallicity ?? ismMetallicity(cloud.positionPc);
  // The bubble is centred on the star that blows it; the cloud is
  // centred on itself. Centring a cloud-scale box on the star would
  // shift the box off the body by however far into the cloud the star
  // happens to have formed — tens of parsecs — and clip the far side.
  // Either way the budget is spent from the star: an evolved bubble is
  // tens of parsecs and the cloud-scale grid resolves it, so the cloud
  // bake ionizes too.
  const source = nebula?.sources[0];
  const originPc: [number, number, number] =
    boxRequestPc === undefined && source ? [source.dxPc, source.dyPc, source.dzPc] : [0, 0, 0];
  const ionizePc: [number, number, number] = source
    ? [source.dxPc - originPc[0], source.dyPc - originPc[1], source.dzPc - originPc[2]]
    : [0, 0, 0];
  // Uniform-reference ionized density from the prescribed expansion
  // radius. The material map supplies the shell's mass and the final
  // photon solve decides which gas can actually remain ionized.
  const { dilution } = nebula ? nebulaGrowth(nebula) : { dilution: 1 };
  // What lights the dust. The whole group's light is assigned to one
  // star; the members huddle at the same clumps, and one origin is
  // what a single shadow ray serves.
  const scatterStar = nebula ? nebulaIlluminant(nebula) : undefined;
  const scatterSourcePc: [number, number, number] = scatterStar
    ? [
        scatterStar.dxPc - originPc[0],
        scatterStar.dyPc - originPc[1],
        scatterStar.dzPc - originPc[2],
      ]
    : [0, 0, 0];
  const reach = Math.max(...cloudHalfExtentsPc(cloud));
  const radiationSources = nebula?.sources.map(s => ({
    positionPc: [s.dxPc, s.dyPc, s.dzPc] as [number, number, number], photonRate: s.photonRate,
  })) ?? [];
  const continuumSources = nebula?.members.map(s => stellarContinuum([s.dxPc, s.dyPc, s.dzPc], s.luminosity, s.tEff)) ?? [];
  const sourceExtent = [...radiationSources, ...continuumSources].reduce((extent, s) => Math.max(extent,
    ...s.positionPc.map((p, axis) => Math.abs(p - originPc[axis]))), 0);
  const boxPc = Math.min(
    reach,
    boxRequestPc ?? Math.max(BOX_MIN_PC, BOX_STROMGREN_RADII * (nebula?.bubbleRadiusPc ?? 0), sourceExtent * 1.05),
  );
  const cellPc = (2 * boxPc) / size;
  const photonRate = radiationSources.reduce((sum, s) => sum + s.photonRate, 0);
  return {
    cloud,
    radiationSources,
    continuumSources,
    feedbackProfile: nebula && photonRate > 0 ? nebulaFeedbackProfile(nebula) : undefined,
    metallicity,
    size,
    boxPc,
    cellPc,
    originPc,
    ionizePc,
    photonRate,
    bubblePc: nebula?.bubbleRadiusPc ?? 0,
    sourceTeff: source?.tEff ?? 40000,
    dilution,
    windCavityPc: nebula?.windCavityPc ?? 0,
    scatterSourcePc,
    scatterLuminositySolar: scatterStar ? (nebula?.totalLuminosity ?? 0) : 0,
    reflectionTeff: Math.max(3000, scatterStar?.tEff ?? 4000),
  };
}

/**
 * Sample the natal gas before motion. CPU and GPU samplers return
 * these same physical fields; neither independently changes density.
 */
export function sampleNebulaCpu(plan: NebulaBakePlan): NebulaBakeFields {
  const { cloud, size, boxPc, cellPc } = plan;
  const cells = size ** 3;
  const fields: NebulaBakeFields = {
    dust: new Float32Array(cells), hydrogen: new Float32Array(cells),
    ionized: new Float32Array(cells), hardness: new Float32Array(cells), transmittance: new Float32Array(cells),
  };
  const dustFactor = cloudDustFactor(cloud), gasPerDust = hydrogenDensity(1, plan.metallicity);
  const inventory = new NebulaGasAccumulator(cellPc, plan.inventoryExclusion);
  for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const at = (k * size + j) * size + i;
    const value = dustFactor * cloudFineDensity(cloud,
      plan.originPc[0] - boxPc + (i + 0.5) * cellPc,
      plan.originPc[1] - boxPc + (j + 0.5) * cellPc,
      plan.originPc[2] - boxPc + (k + 0.5) * cellPc);
    fields.dust[at] = value; fields.hydrogen[at] = value * gasPerDust;
    inventory.add(i, j, k, fields.hydrogen[at], fields.hydrogen[at]);
  }
  fields.gasInventory = inventory.finish();
  return fields;
}

export function nebulaGasGrid(plan: NebulaBakePlan, fields: NebulaBakeFields): GasGrid {
  return { size: plan.size, cellPc: plan.cellPc, originPc: plan.originPc,
    hydrogen: fields.hydrogen, exclusion: plan.inventoryExclusion };
}

/** Move natal material; no independent shell boost or vent-density sink.
 * Dust is fully entrained at fixed abundance in this approximation.
 * Grain destruction/drift and injected stellar material are not modeled. */
export function evolveNebulaGas(plan: NebulaBakePlan, fields: NebulaBakeFields, options: Parameters<typeof remapGas>[2] = {}): NebulaBakeFields {
  const source = plan.ionizePc.map((v, axis) => v + plan.originPc[axis]) as [number, number, number];
  const map = feedbackMaterialMap(source, plan.photonRate > 0 ? plan.bubblePc : 0, plan.dilution, plan.windCavityPc, plan.feedbackProfile);
  const ledger = remapGas(nebulaGasGrid(plan, fields), map, options);
  fields.gasInventory = remappedGasInventory(ledger);
  const gasPerDust = hydrogenDensity(1, plan.metallicity);
  for (let i = 0; i < fields.dust.length; i++) fields.dust[i] = fields.hydrogen[i] / gasPerDust;
  return fields;
}

export const NEBULA_SHADOW_STEPS = 64;
export const NEBULA_SHADOW_CELL_STEP = 2;

/** Continuum shadows cross the final entrained dust. A ray outside this
 * domain sees no invented clamped boundary column. External illumination
 * still needs coupled multi-source transfer when its source is outside. */
export function attenuateNebulaContinuum(plan: NebulaBakePlan, fields: NebulaBakeFields): void {
  const { size, cellPc, boxPc, scatterSourcePc: source } = plan;
  if (plan.continuumSources?.length) {
    fields.continuum = bakeContinuum({ ...plan, sources: plan.continuumSources },
      (x, y, z) => sample(fields.dust, size, (x + boxPc) / cellPc - 0.5, (y + boxPc) / cellPc - 0.5, (z + boxPc) / cellPc - 0.5));
    // No duplicate full-resolution single-source shadow field is needed.
    fields.transmittance.fill(1); return;
  }
  if (plan.scatterLuminositySolar <= 0) { fields.transmittance.fill(1); return; }
  for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const at = (k * size + j) * size + i;
    const x = -boxPc + (i + 0.5) * cellPc - source[0];
    const y = -boxPc + (j + 0.5) * cellPc - source[1];
    const z = -boxPc + (k + 0.5) * cellPc - source[2];
    const distance = Math.hypot(x, y, z);
    // The target is inside the cube. Clip an exterior source's segment
    // exactly at entry rather than dropping whole quadrature samples.
    let entry = 0;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(source[axis]) <= boxPc) continue;
      const delta = axis === 0 ? x : axis === 1 ? y : z;
      entry = Math.max(entry, ((source[axis] < 0 ? -boxPc : boxPc) - source[axis]) / delta);
    }
    const path = distance * (1 - entry);
    const steps = Math.min(NEBULA_SHADOW_STEPS, Math.max(1, Math.ceil(path / (NEBULA_SHADOW_CELL_STEP * cellPc))));
    let tau = 0;
    for (let step = 0; step < steps; step++) {
      const t = entry + (1 - entry) * (step + 0.5) / steps;
      const px = source[0] + x * t, py = source[1] + y * t, pz = source[2] + z * t;
      tau += sample(fields.dust, size, (px + boxPc) / cellPc - 0.5,
        (py + boxPc) / cellPc - 0.5, (pz + boxPc) / cellPc - 0.5) * DUST_OPACITY_PER_PC * path / steps;
      if (tau > 20) break;
    }
    fields.transmittance[at] = Math.exp(-tau);
  }
}

export function marchNebulaCpu(plan: NebulaBakePlan): NebulaBakeFields {
  const fields = evolveNebulaGas(plan, sampleNebulaCpu(plan));
  attenuateNebulaContinuum(plan, fields);
  return solveNebulaIonization(plan, fields);
}

/** Spend photons on the conservatively remapped gas and entrained dust.
 * Both field backends use this same equilibrium solve. */
export function nebulaPhotonSources(plan: NebulaBakePlan): PhotonSource[] {
  // Point deposition uses the centre of the cell containing the
  // group's luminosity centroid. Its sub-cell displacement is at most
  // half a cell per axis; all resolved separations and Q survive.
  return groupPhotonSources(plan.radiationSources?.map(source => ({
    photonRate: source.photonRate,
    sourceCell: source.positionPc.map((p, axis) => (p - plan.originPc[axis] + plan.boxPc) / plan.cellPc) as [number, number, number],
  })) ?? [{ photonRate: plan.photonRate, sourceCell: plan.ionizePc.map(p => (p + plan.boxPc) / plan.cellPc) as [number, number, number] }]).map(source => ({ ...source, sourceCell: source.sourceCell.map(p => Math.floor(p) + 0.5) as [number, number, number] }));
}

export function solveNebulaIonization(plan: NebulaBakePlan, fields: NebulaBakeFields): NebulaBakeFields {
  fields.photonLedger = transportMultiplePhotons({
    size: plan.size, cellPc: plan.cellPc, photonRate: plan.photonRate,
    sourceCell: plan.ionizePc.map(v => (v + plan.boxPc) / plan.cellPc) as [number, number, number],
    hydrogen: fields.hydrogen, dust: fields.dust, ionized: fields.ionized, hardness: fields.hardness,
  }, nebulaPhotonSources(plan), { faintSourceFraction: NEBULA_FAINT_SOURCE_FRACTION });
  return fields;
}

/**
 * Quantize a march's grids and measure the physical/display discrepancy
 * with the same finish whichever processor marched.
 */
export function finishNebulaBake(plan: NebulaBakePlan, fields: NebulaBakeFields): NebulaVolumeBake {
  const { cloud, size, boxPc, cellPc, originPc } = plan;
  const cells = size * size * size;
  const cellVolumePc3 = cellPc ** 3;

  // Byte-quantize against what the grid actually holds: the diluted
  // interior of a grown bubble is orders of magnitude below the natal
  // clump peaks, and a reference taken from those would leave the
  // emission — the thing the eye looks at, squared — a handful of
  // levels deep.
  let dustRef = 1e-6;
  let densityRef = 1e-6;
  let rawEmissionMeasure = 0;
  for (let index = 0; index < cells; index++) {
    if (fields.dust[index] > dustRef) dustRef = fields.dust[index];
    if (fields.ionized[index] > densityRef) densityRef = fields.ionized[index];
    rawEmissionMeasure += fields.ionized[index] ** 2 * cellVolumePc3;
  }
  // Track encoding separately. Neither rounding nor a brightness
  // multiplier can repair the final gas field's recombination demand.
  const data = new Uint8Array(cells * 4);
  let emissionMeasure = 0;

  for (let index = 0; index < cells; index++) {
    const out = index * 4;
    data[out] = Math.round(255 * Math.sqrt(Math.min(1, fields.dust[index] / dustRef)));
    // Round emission down locally: encoding cannot spend extra photons.
    const densityCode = Math.floor(65535 * Math.min(1, fields.ionized[index] / densityRef));
    data[out + 1] = densityCode >> 8;
    data[out + 2] = Math.round(255 * fields.hardness[index]);
    data[out + 3] = densityCode & 255;
    const ionized = densityCode / 65535 * densityRef;
    // What the gas here contributes to the nebula's total light.
    const measure = ionized * ionized * cellVolumePc3;
    emissionMeasure += measure;

  }

  // Physical case-B emissivity per emission measure, including only
  // recombinations that the final gas's photon ledger can support.
  const hBetaCoefficient = emissionMeasure > 0
    ? hydrogenBetaLuminosity(RECOMBINATION_SCALE) / ERG_PER_SOLAR_LUMINOSITY / (4 * Math.PI) : 0;
  const emissionCoefficient = hBetaCoefficient * nebulaLineSum(0, plan.sourceTeff, plan.metallicity);
  const emissionHotCoefficient = hBetaCoefficient * nebulaLineSum(1, plan.sourceTeff, plan.metallicity);

  return {
    seed: cloud.seed,
    size,
    centrePc: [
      cloud.positionPc.xPc + originPc[0],
      cloud.positionPc.yPc + originPc[1],
      cloud.positionPc.zPc + originPc[2],
    ],
    halfExtentsPc: [boxPc, boxPc, boxPc],
    data,
    continuum: fields.continuum,
    occupancy: bakeOccupancy(data, size),
    dustRef,
    emissionCoefficient,
    emissionHotCoefficient,
    photonAccounting: nebulaPhotonAccounting(plan.photonRate, rawEmissionMeasure, emissionMeasure, fields.photonLedger),
    gasInventory: fields.gasInventory,
    densityRef,
    originPc,
    // The line grid sampled at this nebula's own star and gas, the
    // cells' U interpolating between: teal only where the star is hot
    // enough to doubly ionize oxygen, redder skins where the metals
    // run rich, and the whole mixture thinning toward the metal-poor
    // rim of the disc.
    emissionHot: nebulaEmissionColor(1, plan.sourceTeff, plan.metallicity),
    emissionCool: nebulaEmissionColor(0, plan.sourceTeff, plan.metallicity),
    emissionHotNarrow: nebulaNarrowbandColor(1, plan.sourceTeff, plan.metallicity),
    emissionCoolNarrow: nebulaNarrowbandColor(0, plan.sourceTeff, plan.metallicity),
    reflectionColor: blackbodyLinearRgb(plan.reflectionTeff),
    scatterSourcePc: plan.scatterSourcePc,
    scatterLuminositySolar: plan.scatterLuminositySolar,
    // The same spread the members were drawn with, squared.
    scatterFloorPc2: Math.max(cellPc ** 2, (MEMBER_SPREAD * cloud.radiusPc) ** 2),
  };
}

/** Convert the dimensionless GPU natal field to physical gas and dust. */
export function nebulaFieldScales(plan: NebulaBakePlan): { dustScale: number; gasScale: number } {
  const dustScale = cloudCarveDustScale(plan.cloud);
  return { dustScale, gasScale: hydrogenDensity(dustScale, plan.metallicity) };
}

/** Bake a nebula's volume on the CPU — the reference path. */
export function bakeNebulaVolume(
  cloud: MolecularCloud,
  nebula: Nebula | null,
  size = 64,
  boxRequestPc?: number,
): NebulaVolumeBake {
  const plan = planNebulaBake(cloud, nebula, size, boxRequestPc);
  return finishNebulaBake(plan, marchNebulaCpu(plan));
}
