import {
  CM_PER_PC,
  CM_PER_S_LIGHT,
  ERG_PER_SOLAR_LUMINOSITY,
} from '../../core/physics/constants';
import type { LinearRgb } from '../../core/color/srgb';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import {
  cloudCarveDustScale,
  cloudFineDustDensity,
  cloudHalfExtentsPc,
  type MolecularCloud,
} from './clouds';
import { DUST_ALBEDO, DUST_OPACITY_PER_PC } from './density';
import { hydrogenDensity } from './gas';
import {
  DUST_DEPLETION,
  hydrogenBetaLuminosity,
  IONIZATION_REACH,
  RECOMBINATION_SCALE,
  SHELL_SKIN_SHARE,
  SHELL_WIDTH,
  sweptShellBoost,
  WIND_CAVITY_RESIDUAL,
  WIND_WALL_BOOST,
  WIND_WALL_WIDTH,
} from './ionization';
import { MEMBER_SPREAD, nebulaGrowth, nebulaIlluminant, type Nebula } from './nebula';
import { ismMetallicity } from './population';
import { nebulaEmissionColor, nebulaLineSum, nebulaNarrowbandColor } from './nebulaLines';

/**
 * A nebula baked into a volume the renderer can march.
 *
 * The expensive, physical half of the picture is done here, once: the
 * cloud's own density field sampled onto a grid, and the natal group's
 * ionizing budget spent through that field ray by ray. What
 * the front leaves behind is the structure — gas in the shadow of a
 * dense clump stays neutral, which is the beginning of the trunks and
 * cavities a real H II region carves. The shader then only integrates
 * along the view ray.
 *
 * The box is the ionized region and its walls, not the cloud. A giant
 * molecular cloud is a hundred parsecs across and the bubble its
 * newborns blow is a few: gridding the whole cloud puts the entire
 * nebula inside one cell. Orion is the same arrangement — a small
 * blister on the near face of a cloud far larger than it — and the
 * cloud beyond the box is already drawn, as the dark rift it is.
 *
 * The work divides into a plan, a march, and a finish, because the
 * march has two implementations: the CPU walk below, and a GPU render
 * of the same field and the same walk. The CPU field is the physics
 * authority; the GPU is a faster evaluator of it, and both hand the
 * same four grids to the same finish.
 */
export interface NebulaVolumeBake {
  seed: bigint;
  /** Cells per axis. */
  size: number;
  /** Box centre in galactic pc: the ionizing star for the bubble-scale
   *  bake, the cloud's own middle for the cloud-scale one. */
  centrePc: [number, number, number];
  /** Half-extents of the box the grid covers, pc. */
  halfExtentsPc: [number, number, number];
  /**
   * RGBA per cell: dust density, ionized hydrogen density, ionization
   * hardness, and transmittance from the lighting source — the four
   * things the march needs and none of the cost of finding them.
   */
  data: Uint8Array;
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
   * emission measure. The nebula radiates what its star's ionizing
   * budget says it radiates, spread over the gas by n² — so brightness
   * is the physics rather than a dial, and a nebula with ten times the
   * ionizing output is ten times as bright.
   */
  emissionCoefficient: number;
  /** Hydrogen density that G = 255 stands for, cm⁻³. */
  densityRef: number;
  /** Where the box sits in the cloud's own frame, pc — the source is
   *  at the box's centre, so this is also where the light comes from. */
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
 *  direction it goes is the scattering table's business (the phase
 *  and every higher order); this is the scale the table multiplies. */
export const SCATTER_EMISSIVITY_PER_LSUN = (DUST_OPACITY_PER_PC * DUST_ALBEDO) / (16 * Math.PI ** 2);

/** Where log₁₀ of the ionization parameter runs from and to: the range
 *  over which [O III] takes over from the hydrogen lines. */
export const LOG_U_MIN = -3.5;
export const LOG_U_MAX = -1.5;

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
  const at = (a: number, b: number, c: number): number => grid[(c * size + b) * size + a];
  const x00 = at(i, j, k) + (at(i + 1, j, k) - at(i, j, k)) * fx;
  const x10 = at(i, j + 1, k) + (at(i + 1, j + 1, k) - at(i, j + 1, k)) * fx;
  const x01 = at(i, j, k + 1) + (at(i + 1, j, k + 1) - at(i, j, k + 1)) * fx;
  const x11 = at(i, j + 1, k + 1) + (at(i + 1, j + 1, k + 1) - at(i, j + 1, k + 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** Blocks per axis of a bake's occupancy grid. A cloud-sized box is
 *  mostly void — the carve fills a few percent of it — and the march's
 *  cost is in the samples it takes there. */
export const OCCUPANCY_SIZE = 16;

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
        if (data[at] === 0 && data[at + 1] === 0) continue;
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

/**
 * Photoevaporative erosion at the front. The budget march fixes where
 * the mean front got to; what the front is *eating* there is the
 * uncontracted cloud at that very radius, and it does not eat evenly —
 * thin gas evaporates fast and lets the front bulge through, a dense
 * filament resists and stalls it, which is scalloped rims and trunks
 * at clump scale and, at cloud scale, a front that finally follows
 * the cloud's own shape instead of the natal core's smoothness. The
 * local front is the mean scaled by (pivot / ambient)^⅓, bounded:
 * quasi-static like every other mechanism here.
 */
export const EROSION_STALL = 0.75;
export const EROSION_REACH = 1.3;
/** How much budget-overshoot it takes to read fully neutral: the
 *  front's softness, in spent-budget fraction. */
export const FRONT_SOFTNESS = 0.15;
/** The unreachable-cell scatter column: how much coarser than the
 *  march's own step it may walk, and the most steps it ever takes. */
export const SCATTER_STEP_FACTOR = 4;
export const SCATTER_MAX_STEPS = 24;

/**
 * Champagne venting: ten-thousand-kelvin gas is held together by the
 * cloud around it, and where the bubble has outrun the cloud's own
 * body there is nothing left to hold — the ionized gas streams out
 * and thins. Quasi-static, like the rest of the bake: the interior
 * keeps its density only where the natal field at that place could
 * confine it, ramping down to a streaming residue where the cloud is
 * gone. Because the gate is the cloud's own carved boundary, a region
 * on a cloud's face opens into the horseshoe a blister actually is.
 */
export const VENT_RESIDUAL = 0.05;
/** Ambient natal density that fully confines, in units of the diluted
 *  interior's own density. */
export const VENT_CONFINEMENT = 1;

/** Whether the bubble deserves a bake of its own, or the cloud-scale
 *  grid already resolves it: the two-scale split exists for compact
 *  regions, and an evolved bubble tens of parsecs across is not one. */
export function bubbleNeedsOwnBake(nebula: Nebula, reachPc: number): boolean {
  return nebula.photonRate > 0 && BOX_STROMGREN_RADII * nebula.bubbleRadiusPc < reachPc * 0.75;
}

/**
 * Everything both marches need, worked out once from the nebula: the
 * box, the source, the Spitzer growth, and the scales that turn the
 * dimensionless field into gas, dust and spent photons.
 */
export interface NebulaBakePlan {
  cloud: MolecularCloud;
  metallicity: number;
  size: number;
  boxPc: number;
  /** Cell edge, pc — the box is a cube. */
  cellPc: number;
  originPc: [number, number, number];
  /** Where the ionizing budget radiates from, box frame, pc. */
  ionizePc: [number, number, number];
  /** Photons s⁻¹ sr⁻¹ radiated from the source point: the whole
   *  group's output, since its Strömgren and Spitzer radii and the
   *  sprite's flux closure are all drawn on that total and the tiers
   *  must spend the same budget. */
  budget: number;
  /** The group's output, photons s⁻¹ — what closes the emission
   *  books in the finish. */
  photonRate: number;
  /** The dominant source's temperature, K — the line grid's first
   *  axis, alongside the plan's metallicity and the cells' own U. */
  sourceTeff: number;
  growth: number;
  dilution: number;
  shellBoost: number;
  /** The wind-blown cavity about the source, pc — zero when no wind. */
  windCavityPc: number;
  /** Where the cavity's swept wall ends, pc. */
  windWallPc: number;
  /** Natal density, cm⁻³, above which the interior is fully confined
   *  — the champagne gate, scaled to the diluted interior. */
  ventConfineDensity: number;
  /** The erosion modulation's pivot, cm⁻³ — the same interior scale,
   *  carried separately so either mechanism can be disarmed alone. */
  erosionPivotDensity: number;
  stepPc: number;
  /** Beyond this distance from the source a cell is neutral without
   *  the march having to say so. */
  reachLimitPc: number;
  scatterSourcePc: [number, number, number];
  scatterLuminositySolar: number;
  /** The illuminant's temperature, K, floored — the reflection hue. */
  reflectionTeff: number;
}

/** The four grids a march produces, still in physical units. */
export interface NebulaBakeFields {
  dust: Float32Array;
  ionized: Float32Array;
  hardness: Float32Array;
  transmittance: Float32Array;
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
  // Spitzer growth: the front at the group's age is the natal front
  // scaled by this factor, its interior diluted by growth^{-3/2} —
  // which conserves the recombination budget exactly (n²V invariant),
  // so the natal march read in contracted coordinates IS the evolved
  // region.
  const { growth, dilution } = nebula ? nebulaGrowth(nebula) : { growth: 1, dilution: 1 };
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
  const boxPc = Math.min(
    reach,
    boxRequestPc ?? Math.max(BOX_MIN_PC, BOX_STROMGREN_RADII * (nebula?.bubbleRadiusPc ?? 0)),
  );
  const cellPc = (2 * boxPc) / size;
  // The whole group's photons leave from its dominant member's place:
  // the members huddle at the same clumps, and one origin is what a
  // single shadow ray serves.
  const photonRate = source ? (nebula?.photonRate ?? 0) : 0;
  const budget = photonRate / (4 * Math.PI);
  return {
    cloud,
    metallicity,
    size,
    boxPc,
    cellPc,
    originPc,
    ionizePc,
    budget,
    photonRate,
    sourceTeff: source?.tEff ?? 40000,
    growth,
    dilution,
    shellBoost: sweptShellBoost(dilution),
    windCavityPc: nebula?.windCavityPc ?? 0,
    windWallPc: (nebula?.windCavityPc ?? 0) * (1 + WIND_WALL_WIDTH),
    ventConfineDensity:
      VENT_CONFINEMENT * (nebula?.sourceHydrogenDensity ?? 0) * dilution,
    erosionPivotDensity:
      VENT_CONFINEMENT * (nebula?.sourceHydrogenDensity ?? 0) * dilution,
    stepPc: cellPc * 0.9,
    reachLimitPc: IONIZATION_REACH * Math.max(nebula?.bubbleRadiusPc ?? 0, 0.05),
    scatterSourcePc,
    scatterLuminositySolar: scatterStar ? (nebula?.totalLuminosity ?? 0) : 0,
    reflectionTeff: Math.max(3000, scatterStar?.tEff ?? 4000),
  };
}

/**
 * The march, on the CPU: the cloud's field sampled onto the grid, then
 * the ionizing budget spent outward from the brightest member. One
 * source and one ray per cell: the front is where the photons run out
 * along that ray, so a clump shadows everything behind it.
 */
export function marchNebulaCpu(plan: NebulaBakePlan): NebulaBakeFields {
  const {
    cloud,
    size,
    boxPc,
    cellPc,
    ionizePc,
    budget,
    growth,
    dilution,
    shellBoost,
    stepPc,
    reachLimitPc,
    scatterSourcePc,
    scatterLuminositySolar,
  } = plan;
  // Box coordinates are offsets from the source; the cloud's field is
  // read at the matching place in the cloud's own frame.
  const at = (i: number): number => -boxPc + (i + 0.5) * cellPc;
  const inCloud = (offset: number, axis: number): number => offset + plan.originPc[axis];

  // The field itself, once. Everything after this reads the grid.
  const cells = size * size * size;
  const dust = new Float32Array(cells);
  const gas = new Float32Array(cells);
  for (let k = 0; k < size; k++) {
    const z = inCloud(at(k), 2);
    for (let j = 0; j < size; j++) {
      const y = inCloud(at(j), 1);
      for (let i = 0; i < size; i++) {
        const value = cloudFineDustDensity(cloud, inCloud(at(i), 0), y, z);
        const index = (k * size + j) * size + i;
        dust[index] = value;
        gas[index] = hydrogenDensity(value, plan.metallicity);
      }
    }
  }

  const fields: NebulaBakeFields = {
    dust: new Float32Array(cells),
    ionized: new Float32Array(cells),
    hardness: new Float32Array(cells),
    transmittance: new Float32Array(cells),
  };
  for (let k = 0; k < size; k++) {
    const z = at(k);
    for (let j = 0; j < size; j++) {
      const y = at(j);
      for (let i = 0; i < size; i++) {
        const x = at(i);
        const index = (k * size + j) * size + i;
        const dx = x - ionizePc[0];
        const dy = y - ionizePc[1];
        const dz = z - ionizePc[2];
        const distancePc = Math.hypot(dx, dy, dz) || 1e-4;
        // Past the front's furthest possible reach the gas is neutral
        // whatever the march would say, and saying so costs nothing.
        const reachable = budget > 0 && distancePc < reachLimitPc;
        const steps = reachable ? Math.max(1, Math.ceil(distancePc / stepPc)) : 0;
        const ds = distancePc / steps;
        const ux = dx / distancePc;
        const uy = dy / distancePc;
        const uz = dz / distancePc;

        let recombined = 0;
        let tau = 0;
        let frontR = -1;
        if (reachable) {
          // One walk in the evolved region's own space. While the
          // budget lasts, the gas here is the natal field read at
          // contracted radius r/growth and diluted — the Spitzer
          // interior — so the budget integral in those coordinates is
          // exactly the natal one. Where it runs out the front stands,
          // the swept shell just past it, the untouched cloud beyond.
          for (let s = 0; s < steps; s++) {
            const r = (s + 0.5) * ds;
            if (frontR < 0) {
              const rn = r / growth;
              const px = (ionizePc[0] + ux * rn + boxPc) / cellPc - 0.5;
              const py = (ionizePc[1] + uy * rn + boxPc) / cellPc - 0.5;
              const pz = (ionizePc[2] + uz * rn + boxPc) / cellPc - 0.5;
              const n = sample(gas, size, px, py, pz);
              // Recombinations in this shell of the ray's own solid
              // angle, in natal coordinates: dr' = dr / growth.
              recombined += n * n * RECOMBINATION_SCALE * rn * rn * (ds / growth);
              if (recombined >= budget) frontR = r;
              // The beam crosses the ionized interior's thinned dust —
              // the same depletion the stored dust carries there.
              tau +=
                (sample(dust, size, px, py, pz) * dilution * DUST_OPACITY_PER_PC * ds) /
                DUST_DEPLETION;
            } else {
              const swept = r <= frontR * (1 + SHELL_WIDTH) ? shellBoost : 1;
              const px = (ionizePc[0] + ux * r + boxPc) / cellPc - 0.5;
              const py = (ionizePc[1] + uy * r + boxPc) / cellPc - 0.5;
              const pz = (ionizePc[2] + uz * r + boxPc) / cellPc - 0.5;
              tau += sample(dust, size, px, py, pz) * swept * DUST_OPACITY_PER_PC * ds;
            }
          }
        } else if (scatterLuminositySolar > 0) {
          // Beyond it only the dust column is wanted — what the star's
          // light is dimmed and reddened by — and it is smooth enough
          // at this range to take in far coarser steps. The ray runs
          // from the star that actually shines on the dust, which in
          // the cloud-scale bake is not the box centre.
          const sx = x - scatterSourcePc[0];
          const sy = y - scatterSourcePc[1];
          const sz = z - scatterSourcePc[2];
          const shinePc = Math.hypot(sx, sy, sz) || 1e-4;
          const coarse = Math.min(
            SCATTER_MAX_STEPS,
            Math.max(1, Math.ceil(shinePc / (SCATTER_STEP_FACTOR * stepPc))),
          );
          const coarseDs = shinePc / coarse;
          for (let s = 0; s < coarse; s++) {
            const r = (s + 0.5) * coarseDs / shinePc;
            tau +=
              sample(
                dust,
                size,
                (scatterSourcePc[0] + sx * r + boxPc) / cellPc - 0.5,
                (scatterSourcePc[1] + sy * r + boxPc) / cellPc - 0.5,
                (scatterSourcePc[2] + sz * r + boxPc) / cellPc - 0.5,
              ) *
              DUST_OPACITY_PER_PC *
              coarseDs;
          }
        }

        // The front: sharp, but not sharper than a cell can carry, and
        // eroded against what it is actually eating — the uncontracted
        // cloud at the mean front's own radius. Thin ambient lets the
        // local front bulge past the mean, a dense filament stalls it;
        // just past it the swept shell's inner skin is ionized, where
        // the recombinations concentrate, so the rim glows along the
        // eroded shape. The skin is never baked thinner than a cell,
        // or a sub-cell shell aliases into stripes.
        const spent = budget > 0 && reachable ? recombined / budget : Infinity;
        let frontLoc = frontR;
        if (frontR >= 0 && plan.erosionPivotDensity > 0) {
          const ambient = sample(
            gas,
            size,
            (ionizePc[0] + ux * frontR + boxPc) / cellPc - 0.5,
            (ionizePc[1] + uy * frontR + boxPc) / cellPc - 0.5,
            (ionizePc[2] + uz * frontR + boxPc) / cellPc - 0.5,
          );
          frontLoc =
            frontR *
            Math.min(
              EROSION_REACH,
              Math.max(
                EROSION_STALL,
                (plan.erosionPivotDensity / Math.max(1e-6, ambient)) ** (1 / 3),
              ),
            );
        }
        const skin =
          frontR >= 0
            ? distancePc <= frontLoc
              ? 1
              : Math.exp(
                  -(distancePc - frontLoc) /
                    Math.max(cellPc, SHELL_SKIN_SHARE * SHELL_WIDTH * frontLoc),
                )
            : 0;
        const ionized = Math.max(skin, Math.max(0, Math.min(1, (1 - spent) / FRONT_SOFTNESS)));
        const transmittance = Math.exp(-tau);
        // The gas standing at this cell now: the diluted interior read
        // from its natal position, the swept shell just past the
        // eroded front, or the cloud as it was.
        const inBubble = reachable && frontR < 0;
        const inShell =
          frontR >= 0 && distancePc > frontLoc && distancePc <= frontLoc * (1 + SHELL_WIDTH);
        const rn = distancePc / growth;
        // The star's wind has re-plumbed the interior: the cavity holds
        // an optically empty residue, its swept wall the mass the wind
        // ploughed out of it — a ring in n², a hole inside it. And the
        // champagne gate: where the bubble has outrun the cloud's own
        // body, nothing confines the hot gas and it streams away — the
        // natal field at this very cell decides, so the region opens
        // along the cloud's carved boundary, arcs and horseshoes.
        const confinement =
          inBubble && plan.ventConfineDensity > 0
            ? Math.max(VENT_RESIDUAL, Math.min(1, gas[index] / plan.ventConfineDensity))
            : 1;
        const wind =
          (!inBubble
            ? 1
            : distancePc < plan.windCavityPc
              ? WIND_CAVITY_RESIDUAL
              : distancePc <= plan.windWallPc
                ? WIND_WALL_BOOST
                : 1) * confinement;
        const n =
          (inBubble
            ? sample(
                gas,
                size,
                (ionizePc[0] + ux * rn + boxPc) / cellPc - 0.5,
                (ionizePc[1] + uy * rn + boxPc) / cellPc - 0.5,
                (ionizePc[2] + uz * rn + boxPc) / cellPc - 0.5,
              ) * dilution
            : gas[index] * (inShell ? shellBoost : 1)) * wind;
        // Ionization parameter: ionizing flux over gas density, the
        // ratio that decides how far oxygen is taken.
        const flux = budget > 0 ? (budget * transmittance) / (distancePc * distancePc) : 0;
        const u = n > 0 ? flux / (n * CM_PER_S_LIGHT * CM_PER_PC * CM_PER_PC) : 0;
        const hardness =
          u > 0 ? (Math.log10(u) - LOG_U_MIN) / (LOG_U_MAX - LOG_U_MIN) : 0;

        // Ionized gas holds less dust than the cloud it was carved out
        // of — grains are eroded in the radiation field and swept with
        // the flow — but it is not swept clean: observations and models
        // put H II regions a few times thinner in dust, not twenty, and
        // the dust that remains is what makes them visible in the
        // infrared at all.
        const cellDust =
          (inBubble
            ? sample(
                dust,
                size,
                (ionizePc[0] + ux * rn + boxPc) / cellPc - 0.5,
                (ionizePc[1] + uy * rn + boxPc) / cellPc - 0.5,
                (ionizePc[2] + uz * rn + boxPc) / cellPc - 0.5,
              ) * dilution
            : dust[index] * (inShell ? shellBoost : 1)) * wind;
        fields.dust[index] = cellDust / (1 + (DUST_DEPLETION - 1) * ionized);
        fields.ionized[index] = n * ionized;
        fields.hardness[index] = Math.min(1, Math.max(0, hardness));
        fields.transmittance[index] = transmittance;
      }
    }
  }
  return fields;
}

/**
 * Quantize a march's grids and close the emission books — the same
 * finish whichever processor marched.
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
  for (let index = 0; index < cells; index++) {
    if (fields.dust[index] > dustRef) dustRef = fields.dust[index];
    if (fields.ionized[index] > densityRef) densityRef = fields.ionized[index];
  }
  // The books close on the quantized grid, not the float fields: the
  // byte crush zeroes the dilute interior and rounds the rest, and
  // what it keeps is what the renderer integrates — measured against
  // the floats it can be half the light. The budget belongs to the
  // grid as drawn.
  const data = new Uint8Array(cells * 4);
  let emissionMeasure = 0;
  let hardnessWeighted = 0;
  for (let index = 0; index < cells; index++) {
    const out = index * 4;
    data[out] = Math.round(255 * Math.sqrt(Math.min(1, fields.dust[index] / dustRef)));
    data[out + 1] = Math.round(255 * Math.min(1, fields.ionized[index] / densityRef));
    data[out + 2] = Math.round(255 * fields.hardness[index]);
    data[out + 3] = Math.round(255 * fields.transmittance[index]);
    const ionized = (data[out + 1] / 255) * densityRef;
    // What the gas here contributes to the nebula's total light.
    const measure = ionized * ionized * cellVolumePc3;
    emissionMeasure += measure;
    hardnessWeighted += measure * fields.hardness[index];
  }

  // The budget closes here: the star's ionizing output fixes the Hβ
  // luminosity, the line mixture carries the rest of the optical
  // spectrum with it, and the gas divides that light by n².
  const meanHardness = emissionMeasure > 0 ? hardnessWeighted / emissionMeasure : 0;
  const lineLuminositySolar =
    (hydrogenBetaLuminosity(plan.photonRate) *
      nebulaLineSum(meanHardness, plan.sourceTeff, plan.metallicity)) /
    ERG_PER_SOLAR_LUMINOSITY;
  const emissionCoefficient =
    emissionMeasure > 0 ? lineLuminositySolar / (4 * Math.PI * emissionMeasure) : 0;

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
    occupancy: bakeOccupancy(data, size),
    dustRef,
    emissionCoefficient,
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

/**
 * The march's scales for an evaluator that carries the dimensionless
 * carve and works in single precision: dust and gas per unit of stored
 * carve, optical depth per carve·pc, recombined budget *fraction* per
 * carve²·pc of contracted path, and the ionization-parameter flux
 * factor. The raw factors overflow a 32-bit float — RECOMBINATION_SCALE
 * alone is 10⁴³ — so they are folded here, in doubles, into ratios of
 * order unity.
 */
export interface NebulaMarchScales {
  dustScale: number;
  gasScale: number;
  tauScale: number;
  recombFrac: number;
  fluxScale: number;
}

export function nebulaMarchScales(plan: NebulaBakePlan): NebulaMarchScales {
  const dustScale = cloudCarveDustScale(plan.cloud);
  const gasScale = hydrogenDensity(dustScale, plan.metallicity);
  return {
    dustScale,
    gasScale,
    tauScale: dustScale * DUST_OPACITY_PER_PC,
    recombFrac: plan.budget > 0 ? (gasScale * gasScale * RECOMBINATION_SCALE) / plan.budget : 0,
    fluxScale: plan.budget / (CM_PER_S_LIGHT * CM_PER_PC * CM_PER_PC),
  };
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
