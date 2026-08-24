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

const cellCache = new Map<string, MolecularCloud[]>();

/** The clouds of one 250 pc cell — any cell, any order, always identical. */
export function cloudsInCell(ix: number, iy: number, iz: number): MolecularCloud[] {
  const key = `${ix}:${iy}:${iz}`;
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
    clouds.push({
      seed: deriveSeed(seed, 'cloud', i),
      positionPc: {
        xPc: (ix + rng.float()) * CELL_PC,
        yPc: (iy + rng.float()) * CELL_PC,
        zPc: (iz + rng.float()) * CELL_PC,
      },
      radiusPc,
      amplitude: rng.range(2.5, 7) * (30 / radiusPc) ** 0.4,
    });
  }
  cellCache.set(key, clouds);
  if (cellCache.size > 20000) cellCache.clear();
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
 * Summed cloud overdensity at a point: the clumped component of the
 * interstellar medium. Zero in inter-cloud space; several inside a
 * cloud core. Cloud interiors are shaped by seeded noise so sightlines
 * through one vary — the same structure the nebula sprites show.
 */
export function cloudFieldAt(positionPc: GalacticPosition): number {
  const ix = Math.floor(positionPc.xPc / CELL_PC);
  const iy = Math.floor(positionPc.yPc / CELL_PC);
  const iz = Math.floor(positionPc.zPc / CELL_PC);
  let sum = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const cloud of cloudsInCell(ix + dx, iy + dy, iz + dz)) {
          const rx = positionPc.xPc - cloud.positionPc.xPc;
          const ry = positionPc.yPc - cloud.positionPc.yPc;
          const rz = positionPc.zPc - cloud.positionPc.zPc;
          const dSq = rx * rx + ry * ry + rz * rz;
          const reach = cloud.radiusPc * 1.6;
          if (dSq > reach * reach) continue;
          const envelope = Math.exp((-1.8 * dSq) / (cloud.radiusPc * cloud.radiusPc));
          const offset = Number(cloud.seed & 0xffn);
          const wisp =
            0.6 +
            0.5 *
              shapeNoise(
                rx / cloud.radiusPc + offset,
                ry / cloud.radiusPc,
                rz / cloud.radiusPc,
              );
          sum += cloud.amplitude * envelope * Math.max(0, wisp);
        }
      }
    }
  }
  return sum;
}
