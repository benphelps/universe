import { poisson } from '../../core/rng/distributions';
import { deriveSeed, mix64 } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { ARM_BOOST_MAX, armBoost, dustDensity, HOME_POSITION, type GalacticPosition } from './density';
import { galaxyRoot } from './galaxySeed';

/**
 * Open clusters as first-class objects of the galaxy model: the coeval
 * groups that have left their natal gas — from the youngest the clouds
 * have just released to the few that survive a couple of gigayears —
 * seeded per cell like the clouds, so a cluster stands at one place
 * with one age and one membership from every viewpoint. They trace
 * what young objects trace, the dust disk concentrated onto the arms,
 * and the natal groups still inside their clouds are the nebula
 * model's, not these.
 */
export interface OpenCluster {
  seed: bigint;
  positionPc: GalacticPosition;
  ageGyr: number;
  /** Members drawn down to a solar mass, roughly. */
  richness: number;
  /** Gaussian core radius, pc. */
  coreRadiusPc: number;
}

const CELL_PC = 250;
/** Clusters per pc³ at the solar circle: the observed young-disk
 *  count, ~1.8 per 10⁷ pc³. */
const HOME_DENSITY_PER_PC3 = 1.8e-7;
/** The clouds disperse at about this age, releasing their groups. */
const YOUNGEST_GYR = 0.012;
const OLDEST_GYR = 2.5;

let root: bigint | null = null;
function rootOf(): bigint {
  return (root ??= deriveSeed(galaxyRoot(0x4f43n), 'clusters'));
}

/** The young disk's tracer: the dust disk concentrated onto the arms,
 *  as the clouds are. */
function tracer(position: GalacticPosition): number {
  return (
    dustDensity(position) *
    (0.4 + 0.6 * armBoost(Math.hypot(position.xPc, position.yPc), Math.atan2(position.yPc, position.xPc)))
  );
}

let tracerHome = 0;
function tracerHomeOf(): number {
  return (tracerHome ||= tracer(HOME_POSITION));
}

/** An upper bound on the tracer anywhere in a cell: the dust falls
 *  with radius and height, so it is read at the cell's point nearest
 *  the centre and the midplane, with the arm at its maximum. */
function tracerCeiling(ix: number, iy: number, iz: number): number {
  const nearest = (lo: number): number => Math.min(Math.max(0, lo), lo + CELL_PC);
  return (
    dustDensity({ xPc: nearest(ix * CELL_PC), yPc: nearest(iy * CELL_PC), zPc: nearest(iz * CELL_PC) }) *
    (0.4 + 0.6 * ARM_BOOST_MAX)
  );
}

const cellCache = new Map<number, OpenCluster[]>();

function cellKey(ix: number, iy: number, iz: number): number {
  return ix + 512 + (iy + 512) * 1024 + (iz + 512) * 1048576;
}

/** The clusters of one cell — any cell, any order, always identical. */
export function clustersInCell(ix: number, iy: number, iz: number): OpenCluster[] {
  const key = cellKey(ix, iy, iz);
  const cached = cellCache.get(key);
  if (cached) return cached;
  const seed = mix64(
    rootOf() ^
      ((BigInt(ix & 0xfffff) << 42n) | (BigInt(iy & 0xfffff) << 22n) | BigInt(iz & 0x3fffff)),
  );
  const rng = new Rng(seed);
  const ceiling = tracerCeiling(ix, iy, iz) / tracerHomeOf();
  const count = poisson(rng, Math.min(HOME_DENSITY_PER_PC3 * CELL_PC ** 3 * ceiling, 40));
  const clusters: OpenCluster[] = [];
  for (let i = 0; i < count; i++) {
    const positionPc = {
      xPc: (ix + rng.float()) * CELL_PC,
      yPc: (iy + rng.float()) * CELL_PC,
      zPc: (iz + rng.float()) * CELL_PC,
    };
    const keep = rng.float() * ceiling < tracer(positionPc) / tracerHomeOf();
    const ageGyr = YOUNGEST_GYR * (OLDEST_GYR / YOUNGEST_GYR) ** rng.float();
    const richness = Math.floor(10 ** rng.range(1.7, 3));
    const coreRadiusPc = rng.range(1.5, 5);
    if (!keep) continue;
    clusters.push({ seed: deriveSeed(seed, 'cluster', i), positionPc, ageGyr, richness, coreRadiusPc });
  }
  cellCache.set(key, clusters);
  if (cellCache.size > 20000) cellCache.clear();
  return clusters;
}

/** All clusters within radiusPc of a point. */
export function clustersNear(positionPc: GalacticPosition, radiusPc: number): OpenCluster[] {
  const found: OpenCluster[] = [];
  const lo = [positionPc.xPc, positionPc.yPc, positionPc.zPc].map((v) => Math.floor((v - radiusPc) / CELL_PC));
  const hi = [positionPc.xPc, positionPc.yPc, positionPc.zPc].map((v) => Math.floor((v + radiusPc) / CELL_PC));
  const radiusSq = radiusPc * radiusPc;
  for (let ix = lo[0]; ix <= hi[0]; ix++) {
    for (let iy = lo[1]; iy <= hi[1]; iy++) {
      for (let iz = lo[2]; iz <= hi[2]; iz++) {
        for (const cluster of clustersInCell(ix, iy, iz)) {
          const dx = cluster.positionPc.xPc - positionPc.xPc;
          const dy = cluster.positionPc.yPc - positionPc.yPc;
          const dz = cluster.positionPc.zPc - positionPc.zPc;
          if (dx * dx + dy * dy + dz * dz <= radiusSq) found.push(cluster);
        }
      }
    }
  }
  return found;
}
