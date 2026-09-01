import { PARSEC } from '../../core/physics/constants';
import type { LinearRgb } from '../../core/color/srgb';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import { cloudFineDustDensity, cloudHalfExtentsPc, type MolecularCloud } from './clouds';
import { DUST_OPACITY_PER_PC } from './density';
import { hydrogenDensity } from './gas';
import { hydrogenBetaLuminosity } from './ionization';
import { ALPHA_B } from './ionization';
import type { Nebula } from './nebula';
import { ismMetallicity } from './population';
import { nebulaEmissionColor, nebulaLineSum } from './nebulaLines';

/**
 * A nebula baked into a volume the renderer can march.
 *
 * The expensive, physical half of the picture is done here, once: the
 * cloud's own density field sampled onto a grid, and the ionizing
 * budget of its hottest star spent through that field ray by ray. What
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
  /** Dust density that R = 255 stands for. */
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
  /** The source's own light, for what the dust scatters. */
  reflectionColor: LinearRgb;
  /** Where what shines on the dust stands, box frame, pc: the ionizing
   *  star when there is one, else the group's brightest member — the
   *  A-channel transmittance rays radiate from here. */
  scatterSourcePc: [number, number, number];
  /** What the group shines on the dust from there, L☉. Zero leaves
   *  the dust dark: a rift with no stars scatters nothing. */
  scatterLuminositySolar: number;
}

const CM_PER_PC = PARSEC * 100;
/** erg s⁻¹ in one solar luminosity. */
const ERG_PER_SOLAR_LUMINOSITY = 3.828e33;
/** Recombinations per steradian carried by one cm⁻⁶ over a pc³ shell. */
const RECOMBINATION_SCALE = ALPHA_B * CM_PER_PC ** 3;
/** Where log₁₀ of the ionization parameter runs from and to: the range
 *  over which [O III] takes over from the hydrogen lines. */
const LOG_U_MIN = -3.5;
const LOG_U_MAX = -1.5;

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

/** How much of the neutral wall around the ionized region the box
 *  keeps: enough to see the cavity it is carving out of. */
const BOX_STROMGREN_RADII = 4;
/** Even an unlit cocoon gets a body worth looking at. */
const BOX_MIN_PC = 5;
/**
 * How far past the uniform-density Strömgren radius the front can
 * possibly reach. Density only rises toward the source, so a ray runs
 * furthest down the thinnest channel it can find — measured at three
 * to four times, and a cell beyond this bound is neutral without
 * needing the march to say so. At cloud scale that is nearly every
 * cell, and it is what keeps a box a hundred parsecs across affordable.
 */
const IONIZATION_REACH = 10;

/** How much thinner in dust an ionized region is than the neutral gas
 *  around it. Models and infrared observations of H II regions put this
 *  at a few, not the near-total removal a clean cavity would imply. */
const DUST_DEPLETION = 5;

/**
 * Bake a nebula's volume. `boxPc` chooses the scale: left out, the box
 * is the ionized bubble and its walls — what you look at from close
 * to. Given, it is whatever the caller wants covered, which is how the
 * cloud itself gets a volume for the view from outside.
 */
export function bakeNebulaVolume(
  cloud: MolecularCloud,
  nebula: Nebula | null,
  size = 64,
  boxRequestPc?: number,
): NebulaVolumeBake {
  const metallicity = nebula?.metallicity ?? ismMetallicity(cloud.positionPc);
  // The bubble is centred on the star that blows it; the cloud is
  // centred on itself. Centring a cloud-scale box on the star would
  // shift the box off the body by however far into the cloud the star
  // happens to have formed — tens of parsecs — and clip the far side.
  const source = boxRequestPc === undefined ? nebula?.sources[0] : undefined;
  const originPc: [number, number, number] = source
    ? [source.dxPc, source.dyPc, source.dzPc]
    : [0, 0, 0];
  // What lights the dust: the ionizing star where one stands, else the
  // brightest of the natal group — a reflection nebula's illuminator.
  // The whole group's light is assigned to it; the members huddle at
  // the same clumps, and one origin is what a single shadow ray serves.
  const scatterStar =
    nebula?.sources[0] ??
    nebula?.members.reduce(
      (best, member) => (member.luminosity > (best?.luminosity ?? 0) ? member : best),
      undefined as Nebula['members'][number] | undefined,
    );
  const scatterSourcePc: [number, number, number] = scatterStar
    ? [
        scatterStar.dxPc - originPc[0],
        scatterStar.dyPc - originPc[1],
        scatterStar.dzPc - originPc[2],
      ]
    : [0, 0, 0];
  const scatterLuminositySolar = scatterStar ? (nebula?.totalLuminosity ?? 0) : 0;
  const reach = Math.max(...cloudHalfExtentsPc(cloud));
  const boxPc = Math.min(
    reach,
    boxRequestPc ?? Math.max(BOX_MIN_PC, BOX_STROMGREN_RADII * (nebula?.stromgrenRadiusPc ?? 0)),
  );
  const halfExtentsPc: [number, number, number] = [boxPc, boxPc, boxPc];
  const cellPc: [number, number, number] = [
    (2 * boxPc) / size,
    (2 * boxPc) / size,
    (2 * boxPc) / size,
  ];
  // Box coordinates are offsets from the source; the cloud's field is
  // read at the matching place in the cloud's own frame.
  const at = (i: number, axis: number): number => -boxPc + (i + 0.5) * cellPc[axis];
  const inCloud = (offset: number, axis: number): number => offset + originPc[axis];

  // The field itself, once. Everything after this reads the grid.
  const cells = size * size * size;
  const dust = new Float32Array(cells);
  const gas = new Float32Array(cells);
  let dustRef = 1e-6;
  let densityRef = 1e-6;
  for (let k = 0; k < size; k++) {
    const z = inCloud(at(k, 2), 2);
    for (let j = 0; j < size; j++) {
      const y = inCloud(at(j, 1), 1);
      for (let i = 0; i < size; i++) {
        const value = cloudFineDustDensity(cloud, inCloud(at(i, 0), 0), y, z);
        const index = (k * size + j) * size + i;
        dust[index] = value;
        const n = hydrogenDensity(value, metallicity);
        gas[index] = n;
        if (value > dustRef) dustRef = value;
        if (n > densityRef) densityRef = n;
      }
    }
  }

  // The ionizing budget, spent outward from the brightest member. One
  // source and one ray per cell: the front is where the photons run
  // out along that ray, so a clump shadows everything behind it.
  const budget = (source?.photonRate ?? 0) / (4 * Math.PI);
  const stepPc = Math.min(cellPc[0], cellPc[1], cellPc[2]) * 0.9;

  const data = new Uint8Array(cells * 4);
  const cellVolumePc3 = cellPc[0] * cellPc[1] * cellPc[2];
  let emissionMeasure = 0;
  let hardnessWeighted = 0;
  for (let k = 0; k < size; k++) {
    const z = at(k, 2);
    for (let j = 0; j < size; j++) {
      const y = at(j, 1);
      for (let i = 0; i < size; i++) {
        const x = at(i, 0);
        const index = (k * size + j) * size + i;
        const dx = x;
        const dy = y;
        const dz = z;
        const distancePc = Math.hypot(dx, dy, dz) || 1e-4;
        // Past the front's furthest possible reach the gas is neutral
        // whatever the march would say, and saying so costs nothing.
        const reachable =
          budget > 0 &&
          distancePc < IONIZATION_REACH * Math.max(nebula?.stromgrenRadiusPc ?? 0, 0.05);
        const steps = reachable ? Math.max(1, Math.ceil(distancePc / stepPc)) : 0;
        const ds = distancePc / steps;
        const ux = dx / distancePc;
        const uy = dy / distancePc;
        const uz = dz / distancePc;

        let recombined = 0;
        let tau = 0;
        if (reachable) {
          // Inside the front's possible reach both integrals want the
          // same fine steps, so they share one walk.
          for (let s = 0; s < steps; s++) {
            const r = (s + 0.5) * ds;
            const px = (ux * r + boxPc) / cellPc[0] - 0.5;
            const py = (uy * r + boxPc) / cellPc[1] - 0.5;
            const pz = (uz * r + boxPc) / cellPc[2] - 0.5;
            const n = sample(gas, size, px, py, pz);
            // Recombinations in this shell of the ray's own solid angle.
            recombined += n * n * RECOMBINATION_SCALE * r * r * ds;
            tau += sample(dust, size, px, py, pz) * DUST_OPACITY_PER_PC * ds;
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
          const coarse = Math.min(24, Math.max(1, Math.ceil(shinePc / (4 * stepPc))));
          const coarseDs = shinePc / coarse;
          for (let s = 0; s < coarse; s++) {
            const r = (s + 0.5) * coarseDs / shinePc;
            tau +=
              sample(
                dust,
                size,
                (scatterSourcePc[0] + sx * r + boxPc) / cellPc[0] - 0.5,
                (scatterSourcePc[1] + sy * r + boxPc) / cellPc[1] - 0.5,
                (scatterSourcePc[2] + sz * r + boxPc) / cellPc[2] - 0.5,
              ) *
              DUST_OPACITY_PER_PC *
              coarseDs;
          }
        }

        // The front: sharp, but not sharper than a cell can carry.
        const spent = budget > 0 && reachable ? recombined / budget : Infinity;
        const ionized = Math.max(0, Math.min(1, (1 - spent) / 0.15));
        const transmittance = Math.exp(-tau);
        const n = gas[index];
        // Ionization parameter: ionizing flux over gas density, the
        // ratio that decides how far oxygen is taken.
        const flux = budget > 0 ? (budget * transmittance) / (distancePc * distancePc) : 0;
        const u = n > 0 ? flux / (n * 2.998e10 * CM_PER_PC * CM_PER_PC) : 0;
        const hardness =
          u > 0 ? (Math.log10(u) - LOG_U_MIN) / (LOG_U_MAX - LOG_U_MIN) : 0;

        // What the gas here contributes to the nebula's total light.
        const ionizedDensity = n * ionized;
        const measure = ionizedDensity * ionizedDensity * cellVolumePc3;
        emissionMeasure += measure;
        hardnessWeighted += measure * Math.min(1, Math.max(0, hardness));

        // Ionized gas holds less dust than the cloud it was carved out
        // of — grains are eroded in the radiation field and swept with
        // the flow — but it is not swept clean: observations and models
        // put H II regions a few times thinner in dust, not twenty, and
        // the dust that remains is what makes them visible in the
        // infrared at all.
        const out = index * 4;
        const thinned = dust[index] / (1 + (DUST_DEPLETION - 1) * ionized);
        data[out] = Math.round(255 * Math.min(1, thinned / dustRef));
        data[out + 1] = Math.round(255 * Math.min(1, (n * ionized) / densityRef));
        data[out + 2] = Math.round(255 * Math.min(1, Math.max(0, hardness)));
        data[out + 3] = Math.round(255 * transmittance);
      }
    }
  }

  // The budget closes here: the star's ionizing output fixes the Hβ
  // luminosity, the line mixture carries the rest of the optical
  // spectrum with it, and the gas divides that light by n².
  const meanHardness = emissionMeasure > 0 ? hardnessWeighted / emissionMeasure : 0;
  const lineLuminositySolar =
    (hydrogenBetaLuminosity(source?.photonRate ?? 0) * nebulaLineSum(meanHardness)) /
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
    halfExtentsPc,
    data,
    dustRef,
    emissionCoefficient,
    densityRef,
    originPc,
    emissionHot: nebulaEmissionColor(1),
    emissionCool: nebulaEmissionColor(0),
    reflectionColor: blackbodyLinearRgb(Math.max(3000, scatterStar?.tEff ?? 4000)),
    scatterSourcePc,
    scatterLuminositySolar,
  };
}
