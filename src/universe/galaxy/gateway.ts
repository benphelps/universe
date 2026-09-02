import { seedToHex } from '../../core/rng/hash';
import { starsNear } from './catalog';
import { cloudFieldAt, cloudLocalDensity, cloudReachPc, type MolecularCloud } from './clouds';
import type { GalacticPosition } from './density';

/**
 * Where a cloud is visited from. Nothing but a cloud's own natal group
 * stands inside it — field stars pass through at the gas's small
 * filling factor and no more — so the place to arrive is a star that
 * really is there: the nearest catalog star outside the gas, off the
 * cloud's thinnest side, where the body is least in the way of its own
 * view. A lit region's thinnest side is where its ionized interior
 * vents, so a nebula is met at its bright face.
 */
export interface CloudGateway {
  seed: bigint;
  seedHex: string;
  positionPc: GalacticPosition;
}

/** Directions the column out of the centre is marched along. */
const VANTAGE_DIRECTIONS = 64;
const VANTAGE_STEPS = 48;
/** How far past the reach the vantage stands, and how the search for
 *  a star there widens until one is found outside the gas. */
const VANTAGE_STANDOFF = 1.05;
const SEARCH_RADII_PC = [6, 12, 24, 48, 96, 192];

const cache = new Map<bigint, CloudGateway>();

/** The unit direction from the cloud's centre along which its own
 *  column is thinnest, and the point just past the reach that way. */
export function cloudVantage(cloud: MolecularCloud): {
  direction: [number, number, number];
  positionPc: GalacticPosition;
} {
  const reach = cloudReachPc(cloud);
  const ds = reach / VANTAGE_STEPS;
  let best: [number, number, number] = [0, 0, 1];
  let bestColumn = Infinity;
  for (let i = 0; i < VANTAGE_DIRECTIONS; i++) {
    const z = 1 - (2 * i + 1) / VANTAGE_DIRECTIONS;
    const ring = Math.sqrt(1 - z * z);
    const azimuth = i * 2.399963;
    const ux = ring * Math.cos(azimuth);
    const uy = ring * Math.sin(azimuth);
    let column = 0;
    for (let s = 0; s < VANTAGE_STEPS && column < bestColumn; s++) {
      const r = (s + 0.5) * ds;
      column += cloudLocalDensity(cloud, ux * r, uy * r, z * r) * ds;
    }
    if (column < bestColumn) {
      bestColumn = column;
      best = [ux, uy, z];
    }
  }
  const standoff = reach * VANTAGE_STANDOFF;
  return {
    direction: best,
    positionPc: {
      xPc: cloud.positionPc.xPc + best[0] * standoff,
      yPc: cloud.positionPc.yPc + best[1] * standoff,
      zPc: cloud.positionPc.zPc + best[2] * standoff,
    },
  };
}

/** The nearest catalog star outside any cloud's gas to the vantage. */
export function cloudGateway(cloud: MolecularCloud): CloudGateway {
  const cached = cache.get(cloud.seed);
  if (cached) return cached;
  const { positionPc: vantage } = cloudVantage(cloud);
  let gateway: CloudGateway | null = null;
  const last = SEARCH_RADII_PC[SEARCH_RADII_PC.length - 1];
  for (const radiusPc of SEARCH_RADII_PC) {
    let bestDistanceSq = Infinity;
    for (const star of starsNear(vantage, radiusPc)) {
      const dx = star.positionPc.xPc - vantage.xPc;
      const dy = star.positionPc.yPc - vantage.yPc;
      const dz = star.positionPc.zPc - vantage.zPc;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      // Clouds live in the dust disk, so a star clear of the gas is
      // always near; the widest search takes the nearest star at all
      // rather than come back with nothing.
      if (distanceSq >= bestDistanceSq || (radiusPc < last && cloudFieldAt(star.positionPc) > 0)) {
        continue;
      }
      bestDistanceSq = distanceSq;
      gateway = { seed: star.seed, seedHex: seedToHex(star.seed), positionPc: star.positionPc };
    }
    if (gateway) break;
  }
  if (!gateway) throw new Error('no star within reach of the cloud');
  cache.set(cloud.seed, gateway);
  if (cache.size > 256) cache.clear();
  return gateway;
}
