import { createSimplex3 } from '../../core/noise/simplex3';
import { poisson } from '../../core/rng/distributions';
import { deriveSeed, mix64 } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { armBoost, dustDensity, type GalacticPosition } from './density';

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
const CLOUD_ROOT = deriveSeed(0x474d43n, 'clouds');
/** Local calibration: dust density at the solar circle midplane. */
const DUST_HOME = dustDensity({ xPc: 8000, yPc: 0, zPc: 0 });

const shapeNoise = createSimplex3(deriveSeed(CLOUD_ROOT, 'shape'));
/** Kpc-scale complexes: clouds cluster along arm spurs, not uniformly. */
const complexNoise = createSimplex3(deriveSeed(CLOUD_ROOT, 'complexes'));

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
    CLOUD_ROOT ^
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
    3.0 * (dustDensity(center) / DUST_HOME) * (0.4 + 0.6 * armBoost(radius, azimuth));
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
      amplitude: rng.range(2.5, 7) * (30 / radiusPc) ** 0.4,
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

/**
 * A single cloud's turbulent density at a point: an elongated envelope
 * (seeded stretch axis) carved by three octaves of seeded noise — the
 * carve threshold shapes the boundary itself, so silhouettes are ragged
 * filamentary forms, not spheres. The glow's extinction and the nebula
 * sprites both sample exactly this field, so a rift's shadow and its
 * nebula share one structure.
 */
/** Seeded elongation factor, capped so reach stays within a cell. */
export function cloudStretch(cloud: MolecularCloud): number {
  return Math.min(
    1.3 + (Number((cloud.seed >> 6n) & 0x3fn) / 63) * 1.2,
    200 / (1.6 * cloud.radiusPc),
  );
}

/** Maximum extent of a cloud's density field from its center, pc. */
export function cloudReachPc(cloud: MolecularCloud): number {
  return cloud.radiusPc * 1.6 * cloudStretch(cloud);
}

export function cloudLocalDensity(
  cloud: MolecularCloud,
  rxPc: number,
  ryPc: number,
  rzPc: number,
): number {
  const stretchAxis = Number(cloud.seed >> 4n) % 3;
  const stretch = cloudStretch(cloud);
  const ax = stretchAxis === 0 ? rxPc / stretch : rxPc;
  const ay = stretchAxis === 1 ? ryPc / stretch : ryPc;
  const az = stretchAxis === 2 ? rzPc / stretch : rzPc;
  const dSq = ax * ax + ay * ay + az * az;
  const reach = cloud.radiusPc * 1.6;
  if (dSq > reach * reach) return 0;
  const envelope = Math.exp((-1.8 * dSq) / (cloud.radiusPc * cloud.radiusPc));
  const offset = Number(cloud.seed & 0xffn);
  const x = ax / cloud.radiusPc + offset;
  const y = ay / cloud.radiusPc;
  const z = az / cloud.radiusPc;
  const turbulence =
    0.55 +
    0.55 * shapeNoise(x * 1.6, y * 1.6, z * 1.6) +
    0.3 * shapeNoise(x * 3.7, y * 3.7, z * 3.7) +
    0.16 * shapeNoise(x * 8.1, y * 8.1, z * 8.1);
  const carved = envelope * (Math.max(0, turbulence) + 0.12) - 0.18;
  if (carved <= 0) return 0;
  return cloud.amplitude * 1.35 * carved ** 1.4;
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
