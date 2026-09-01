import { createSimplex3, simplexPermutation } from '../../core/noise/simplex3';
import { poisson } from '../../core/rng/distributions';
import { deriveSeed, mix64 } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { armBoost, dustDensity, type GalacticPosition } from './density';
import { galaxyRoot } from './galaxySeed';

/**
 * Giant molecular clouds as first-class objects of the galaxy model:
 * deterministically seeded per cell, concentrated where the dust disk
 * and spiral arms are. Everything downstream consumes the same
 * population — the Milky Way glow extinguishes through these clouds
 * (each dark rift is a specific cloud), young clusters form inside
 * them, and a nebula is a cloud lit by the stars it formed.
 */
export interface MolecularCloud {
  seed: bigint;
  positionPc: GalacticPosition;
  radiusPc: number;
  /** Central dust-density multiplier over the smooth disk. */
  amplitude: number;
}

const CELL_PC = 250;

/**
 * What puts the drawn population on the interstellar medium it is
 * supposed to be. The carve below decides how much column a given
 * amplitude actually delivers, so this is a Monte Carlo over the
 * population rather than anything analytic, and it is set by three
 * measured anchors rather than by eye: a mean visual extinction of
 * about a magnitude per kiloparsec through the plane, a molecular
 * surface density of a few solar masses per square parsec, and cloud
 * masses on the giant-molecular-cloud scale. The diffuse floor
 * between clouds keeps the medium it was calibrated for; the clouds
 * ride on top of it. Pinned by a galaxy test.
 */
export const CLOUD_DENSITY_GAIN = 132;

/**
 * The carve. Turbulence below the threshold leaves no gas at all, so
 * the threshold's own contour is the cloud's boundary — which is what
 * makes silhouettes ragged instead of round — and the exponent decides
 * how sharply what survives runs up into filaments. Together they set
 * the volume filling factor: a real molecular cloud keeps most of its
 * mass in a few percent of its body, and the stars form in that few
 * percent. The gain above absorbs whatever mean they leave behind.
 *
 * Exported alongside the cascade below because the field has a second
 * evaluator: the GPU bake renders exactly this function, and it reads
 * these numbers rather than keeping a copy that could drift.
 */
export const CARVE_THRESHOLD = 0.3;
export const CARVE_EXPONENT = 2.2;
/** What the carved remainder is scaled by, with the cloud's amplitude. */
export const CARVE_GAIN = 1.35;
/** The floor under the turbulence before the carve subtracts. */
export const TURBULENCE_LIFT = 0.12;
/** Envelope: exp(−tightness·d²/r²), zero past reach·radius. */
export const ENVELOPE_TIGHTNESS = 1.8;
export const ENVELOPE_REACH = 1.6;

/**
 * The turbulent cascade, (frequency, amplitude) per octave in units of
 * the cloud radius: the first three are what a cloud-scale sightline
 * can see, the rest carry the same falloff down to the bubble scale
 * for the one consumer whose cells resolve them.
 */
export const TURBULENCE_OCTAVES: ReadonlyArray<readonly [number, number]> = [
  [1.6, 0.55],
  [3.7, 0.3],
  [8.1, 0.16],
  [17.8, 0.087],
  [39.2, 0.047],
  [86.2, 0.026],
];
/** How much of the cascade the cloud-scale field keeps. */
const CLOUD_OCTAVES = 3;
/** The cascade's mean: what every octave sums to in expectation. */
const TURBULENCE_MEAN = 0.55;

// Galaxy-dependent roots, derived on first use (after the session's
// galaxy seed settles).
let cloudRoot: bigint | null = null;
function rootOf(): bigint {
  return (cloudRoot ??= deriveSeed(galaxyRoot(0x474d43n), 'clouds'));
}
let dustHome = 0;
/** Local calibration: dust density at the solar circle midplane. */
function dustHomeOf(): number {
  return (dustHome ||= dustDensity({ xPc: 8000, yPc: 0, zPc: 0 }));
}
let shapeNoiseFn: ReturnType<typeof createSimplex3> | null = null;
function shapeNoise(x: number, y: number, z: number): number {
  return (shapeNoiseFn ??= createSimplex3(deriveSeed(rootOf(), 'shape')))(x, y, z);
}
/** The shape noise's permutation, for a GPU evaluator of this field. */
export function cloudShapePermutation(): Uint8Array {
  return simplexPermutation(deriveSeed(rootOf(), 'shape'));
}
/** Kpc-scale complexes: clouds cluster along arm spurs, not uniformly. */
let complexNoiseFn: ReturnType<typeof createSimplex3> | null = null;
function complexNoise(x: number, y: number, z: number): number {
  return (complexNoiseFn ??= createSimplex3(deriveSeed(rootOf(), 'complexes')))(x, y, z);
}

const cellCache = new Map<number, MolecularCloud[]>();
const neighborhoodCache = new Map<number, MolecularCloud[]>();

/** Dense numeric cell key (the galaxy spans ≲ ±120 cells). */
function cellKey(ix: number, iy: number, iz: number): number {
  return (ix + 512) + (iy + 512) * 1024 + (iz + 512) * 1048576;
}

/** The clouds of one 250 pc cell — any cell, any order, always identical. */
export function cloudsInCell(ix: number, iy: number, iz: number): MolecularCloud[] {
  const key = cellKey(ix, iy, iz);
  const cached = cellCache.get(key);
  if (cached) return cached;

  const seed = mix64(
    rootOf() ^
      ((BigInt(ix & 0xfffff) << 42n) | (BigInt(iy & 0xfffff) << 22n) | BigInt(iz & 0x3fffff)),
  );
  const rng = new Rng(seed);
  const center: GalacticPosition = {
    xPc: (ix + 0.5) * CELL_PC,
    yPc: (iy + 0.5) * CELL_PC,
    zPc: (iz + 0.5) * CELL_PC,
  };
  const radius = Math.hypot(center.xPc, center.yPc);
  const azimuth = Math.atan2(center.yPc, center.xPc);
  // Clouds trace the dust disk, concentrated onto the arms.
  const expected =
    3.0 * (dustDensity(center) / dustHomeOf()) * (0.4 + 0.6 * armBoost(radius, azimuth));
  const count = poisson(rng, Math.min(expected, 20));

  const clouds: MolecularCloud[] = [];
  for (let i = 0; i < count; i++) {
    const radiusPc = 10 * (65 / 10) ** rng.float() ** 1.6;
    // Clouds settle onto complexes: elongated cloud chains, so their
    // shadows read as coherent rifts rather than isolated specks.
    let positionPc: GalacticPosition = center;
    for (let attempt = 0; attempt < 6; attempt++) {
      positionPc = {
        xPc: (ix + rng.float()) * CELL_PC,
        yPc: (iy + rng.float()) * CELL_PC,
        zPc: (iz + rng.float()) * CELL_PC,
      };
      const membership =
        0.5 + 0.5 * complexNoise(positionPc.xPc / 420, positionPc.yPc / 420, positionPc.zPc / 160);
      if (rng.float() < membership * membership) break;
    }
    clouds.push({
      seed: deriveSeed(seed, 'cloud', i),
      positionPc,
      radiusPc,
      amplitude: CLOUD_DENSITY_GAIN * rng.range(2.5, 7) * (30 / radiusPc) ** 0.4,
    });
  }
  cellCache.set(key, clouds);
  if (cellCache.size > 20000) cellCache.clear();
  return clouds;
}

/** Flattened 27-cell neighborhood, cached: sightline integration hits
 *  the same neighborhood for many consecutive samples. */
function neighborhoodClouds(ix: number, iy: number, iz: number): MolecularCloud[] {
  const key = cellKey(ix, iy, iz);
  const cached = neighborhoodCache.get(key);
  if (cached) return cached;
  const clouds: MolecularCloud[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        clouds.push(...cloudsInCell(ix + dx, iy + dy, iz + dz));
      }
    }
  }
  neighborhoodCache.set(key, clouds);
  if (neighborhoodCache.size > 8192) neighborhoodCache.clear();
  return clouds;
}

/** All clouds within radiusPc of a point (cell sweep). */
export function cloudsNear(positionPc: GalacticPosition, radiusPc: number): MolecularCloud[] {
  const clouds: MolecularCloud[] = [];
  const min = [
    Math.floor((positionPc.xPc - radiusPc) / CELL_PC),
    Math.floor((positionPc.yPc - radiusPc) / CELL_PC),
    Math.floor((positionPc.zPc - radiusPc) / CELL_PC),
  ];
  const max = [
    Math.floor((positionPc.xPc + radiusPc) / CELL_PC),
    Math.floor((positionPc.yPc + radiusPc) / CELL_PC),
    Math.floor((positionPc.zPc + radiusPc) / CELL_PC),
  ];
  const radiusSq = radiusPc * radiusPc;
  for (let ix = min[0]; ix <= max[0]; ix++) {
    for (let iy = min[1]; iy <= max[1]; iy++) {
      for (let iz = min[2]; iz <= max[2]; iz++) {
        for (const cloud of cloudsInCell(ix, iy, iz)) {
          const dx = cloud.positionPc.xPc - positionPc.xPc;
          const dy = cloud.positionPc.yPc - positionPc.yPc;
          const dz = cloud.positionPc.zPc - positionPc.zPc;
          if (dx * dx + dy * dy + dz * dz <= radiusSq) clouds.push(cloud);
        }
      }
    }
  }
  return clouds;
}

/** The axis the cloud is drawn out along. */
export function cloudStretchAxis(cloud: MolecularCloud): number {
  return Number(cloud.seed >> 4n) % 3;
}

/** Seeded elongation factor, capped so reach stays within a cell. */
export function cloudStretch(cloud: MolecularCloud): number {
  return Math.min(
    1.3 + (Number((cloud.seed >> 6n) & 0x3fn) / 63) * 1.2,
    200 / (ENVELOPE_REACH * cloud.radiusPc),
  );
}

/** Maximum extent of a cloud's density field from its center, pc. */
export function cloudReachPc(cloud: MolecularCloud): number {
  return cloud.radiusPc * ENVELOPE_REACH * cloudStretch(cloud);
}

/** Half-extents of the density field about the cloud's centre, pc: the
 *  drawn-out axis reaches further, and the field is zero outside the
 *  box they bound. What a ray has to intersect to find the cloud. */
export function cloudHalfExtentsPc(cloud: MolecularCloud): [number, number, number] {
  const reach = cloud.radiusPc * ENVELOPE_REACH;
  const stretched = reach * cloudStretch(cloud);
  const axis = cloudStretchAxis(cloud);
  return [
    axis === 0 ? stretched : reach,
    axis === 1 ? stretched : reach,
    axis === 2 ? stretched : reach,
  ];
}

/** The nominal body observations would call the cloud, pc³: the
 *  radiusPc ellipsoid, drawn out along the stretch axis. */
export function cloudVolumePc3(cloud: MolecularCloud): number {
  return (4 / 3) * Math.PI * cloud.radiusPc ** 3 * cloudStretch(cloud);
}

/** The weight the clumped component carries in the dust the extinction
 *  integrals read — the same 1.6 the smooth glow gives it. */
export const CLOUD_DUST_WEIGHT = 1.6;

/** Dust density per unit cloud field where this cloud sits: the cloud's
 *  overdensity rides on the smooth disk it condensed out of. Constant
 *  over the cloud, so marches lift it out of their inner loop. */
export function cloudDustFactor(cloud: MolecularCloud): number {
  return dustDensity(cloud.positionPc) * CLOUD_DUST_WEIGHT;
}

/**
 * The cloud's dust density at a point, in the units
 * DUST_OPACITY_PER_PC turns into optical depth — the one place the
 * field's own scale is stated, so extinction, the dark-cloud tiles and
 * the gas behind them cannot drift apart.
 */
export function cloudDustDensity(
  cloud: MolecularCloud,
  rxPc: number,
  ryPc: number,
  rzPc: number,
): number {
  return cloudDustFactor(cloud) * cloudLocalDensity(cloud, rxPc, ryPc, rzPc);
}

/**
 * A single cloud's turbulent density at a point: an elongated envelope
 * (seeded stretch axis) carved by three octaves of seeded noise — the
 * carve threshold shapes the boundary itself, so silhouettes are ragged
 * filamentary forms, not spheres. The glow's extinction and the nebula
 * sprites both sample exactly this field, so a rift's shadow and its
 * nebula share one structure.
 */
export function cloudLocalDensity(
  cloud: MolecularCloud,
  rxPc: number,
  ryPc: number,
  rzPc: number,
): number {
  return carvedDensity(cloud, rxPc, ryPc, rzPc, CLOUD_OCTAVES);
}

/**
 * The same field with the turbulent cascade carried further down.
 *
 * The three cloud octaves are pitched to the cloud: their finest
 * wavelength is a few parsecs, which is everything a sightline stepping
 * in tens of parsecs can see, and nothing more. But an ionized bubble
 * is a few parsecs across, and against a field that smooth its front
 * comes out a bare sphere — real clouds are structured all the way
 * down, and it is exactly that structure a front breaks against to
 * leave trunks and cavities behind. The rest of the cascade continues
 * at the same falloff, for the one consumer whose cells resolve it.
 */
export function cloudFineDensity(
  cloud: MolecularCloud,
  rxPc: number,
  ryPc: number,
  rzPc: number,
): number {
  return carvedDensity(cloud, rxPc, ryPc, rzPc, TURBULENCE_OCTAVES.length);
}

function carvedDensity(
  cloud: MolecularCloud,
  rxPc: number,
  ryPc: number,
  rzPc: number,
  octaves: number,
): number {
  const envelope = cloudEnvelope(cloud, rxPc, ryPc, rzPc);
  if (envelope === 0) return 0;
  const stretchAxis = cloudStretchAxis(cloud);
  const stretch = cloudStretch(cloud);
  const ax = stretchAxis === 0 ? rxPc / stretch : rxPc;
  const ay = stretchAxis === 1 ? ryPc / stretch : ryPc;
  const az = stretchAxis === 2 ? rzPc / stretch : rzPc;
  const offset = Number(cloud.seed & 0xffn);
  const x = ax / cloud.radiusPc + offset;
  const y = ay / cloud.radiusPc;
  const z = az / cloud.radiusPc;
  let turbulence = TURBULENCE_MEAN;
  for (let o = 0; o < octaves; o++) {
    const [frequency, amplitude] = TURBULENCE_OCTAVES[o];
    turbulence += amplitude * shapeNoise(x * frequency, y * frequency, z * frequency);
  }
  const carved = envelope * (Math.max(0, turbulence) + TURBULENCE_LIFT) - CARVE_THRESHOLD;
  if (carved <= 0) return 0;
  return cloud.amplitude * CARVE_GAIN * carved ** CARVE_EXPONENT;
}

/** The stretched gaussian envelope shared by the turbulent and smooth
 *  evaluations; 0 beyond the cloud's reach. */
function cloudEnvelope(
  cloud: MolecularCloud,
  rxPc: number,
  ryPc: number,
  rzPc: number,
): number {
  const stretchAxis = cloudStretchAxis(cloud);
  const stretch = cloudStretch(cloud);
  const ax = stretchAxis === 0 ? rxPc / stretch : rxPc;
  const ay = stretchAxis === 1 ? ryPc / stretch : ryPc;
  const az = stretchAxis === 2 ? rzPc / stretch : rzPc;
  const dSq = ax * ax + ay * ay + az * az;
  const reach = cloud.radiusPc * ENVELOPE_REACH;
  if (dSq > reach * reach) return 0;
  return Math.exp((-ENVELOPE_TIGHTNESS * dSq) / (cloud.radiusPc * cloud.radiusPc));
}

/** The cloud's dust density with the cascade resolved: what the bake
 *  reads, in the same units as cloudDustDensity. */
export function cloudFineDustDensity(
  cloud: MolecularCloud,
  rxPc: number,
  ryPc: number,
  rzPc: number,
): number {
  return cloudDustFactor(cloud) * cloudFineDensity(cloud, rxPc, ryPc, rzPc);
}

/** A cloud's density with the turbulence at its statistical mean:
 *  the same object, resolved without sub-cloud texture — for
 *  consumers whose sample spacing can't see that texture anyway. */
export function cloudSmoothDensity(
  cloud: MolecularCloud,
  rxPc: number,
  ryPc: number,
  rzPc: number,
): number {
  const envelope = cloudEnvelope(cloud, rxPc, ryPc, rzPc);
  if (envelope === 0) return 0;
  const carved = envelope * 0.67 - CARVE_THRESHOLD;
  if (carved <= 0) return 0;
  return cloud.amplitude * CARVE_GAIN * carved ** CARVE_EXPONENT;
}

/**
 * Summed cloud overdensity at a point: the clumped component of the
 * interstellar medium. Zero in inter-cloud space; several inside a
 * cloud core.
 */
export function cloudFieldAt(positionPc: GalacticPosition): number {
  const clouds = neighborhoodClouds(
    Math.floor(positionPc.xPc / CELL_PC),
    Math.floor(positionPc.yPc / CELL_PC),
    Math.floor(positionPc.zPc / CELL_PC),
  );
  let sum = 0;
  for (const cloud of clouds) {
    sum += cloudLocalDensity(
      cloud,
      positionPc.xPc - cloud.positionPc.xPc,
      positionPc.yPc - cloud.positionPc.yPc,
      positionPc.zPc - cloud.positionPc.zPc,
    );
  }
  return sum;
}

/**
 * Expected clumped-cloud overdensity at a point, from the population's
 * own statistics: cloud counts scale with the dust disk and the arms
 * (cloudsInCell above), so the mean field is that same factor times a
 * Monte Carlo constant calibrated against cloudFieldSmoothAt (pinned
 * by a galaxy test). For sightlines whose steps outpace individual
 * clouds, this is the honest integrand — per-cloud sampling there is
 * shot noise, not structure.
 */
export function expectedCloudField(dust: number, armBoostValue: number): number {
  return 0.00088 * CLOUD_DENSITY_GAIN * (dust / dustHomeOf()) * (0.4 + 0.6 * armBoostValue);
}

/** The same summed cloud field with each cloud at its smooth mean:
 *  what a distant sightline integrates when the turbulence is
 *  sub-texel — same population, a fraction of the cost. */
export function cloudFieldSmoothAt(positionPc: GalacticPosition): number {
  const clouds = neighborhoodClouds(
    Math.floor(positionPc.xPc / CELL_PC),
    Math.floor(positionPc.yPc / CELL_PC),
    Math.floor(positionPc.zPc / CELL_PC),
  );
  let sum = 0;
  for (const cloud of clouds) {
    sum += cloudSmoothDensity(
      cloud,
      positionPc.xPc - cloud.positionPc.xPc,
      positionPc.yPc - cloud.positionPc.yPc,
      positionPc.zPc - cloud.positionPc.zPc,
    );
  }
  return sum;
}
