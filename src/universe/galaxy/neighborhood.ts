import { buildTemperatureLut, temperatureToLutCoord } from '../../core/color/blackbody';
import { seedToHex } from '../../core/rng/hash';
import { rotateToScene, sceneFromGalaxy } from './orientation';
import { starPhotometry } from './photometry';
import { starsNear, viewpointForSeed } from './sectors';

/** Matches the sky field's near radius so 3D points hand off to the backdrop. */
export const NEIGHBOR_RADIUS_PC = 30;

export interface Neighbor {
  seedHex: string;
  distancePc: number;
  luminosity: number;
  tEff: number;
}

export interface Neighborhood {
  /** Travel list, nearest first. */
  neighbors: Neighbor[];
  /** Scene-frame positions (per-seed galaxy orientation), pc, relative to home. */
  positionsPc: Float32Array;
  colors: Float32Array;
  luminosities: Float32Array;
  /** Seed per rendered point, aligned with positionsPc (unsorted). */
  seedHexes: string[];
}

/**
 * The resolved stellar neighborhood around a system: every sector star
 * within the sky field's near radius, in scene-frame pc relative to the
 * home star (which is excluded — the system renders it for real).
 */
export function computeNeighborhood(seed: bigint): Neighborhood {
  const viewpoint = viewpointForSeed(seed);
  const orientation = sceneFromGalaxy(seed);
  const lut = buildTemperatureLut(96);
  const positions: number[] = [];
  const colors: number[] = [];
  const luminosities: number[] = [];
  const neighbors: Neighbor[] = [];
  const seedHexes: string[] = [];

  for (const slot of starsNear(viewpoint, NEIGHBOR_RADIUS_PC)) {
    const physical = starPhotometry(slot.seed);
    if (physical.luminosity <= 0) continue;
    const dx = slot.positionPc.xPc - viewpoint.xPc;
    const dy = slot.positionPc.yPc - viewpoint.yPc;
    const dz = slot.positionPc.zPc - viewpoint.zPc;
    if (dx * dx + dy * dy + dz * dz < 1e-6) continue;
    // Into this system's randomly-oriented scene frame, like the backdrop.
    positions.push(...rotateToScene(orientation, dx, dy, dz));
    const lutIndex = Math.min(95, Math.floor(temperatureToLutCoord(physical.tEff) * 95)) * 4;
    colors.push(lut[lutIndex], lut[lutIndex + 1], lut[lutIndex + 2]);
    luminosities.push(physical.luminosity);
    seedHexes.push(seedToHex(slot.seed));
    neighbors.push({
      seedHex: seedToHex(slot.seed),
      distancePc: Math.hypot(dx, dy, dz),
      luminosity: physical.luminosity,
      tEff: physical.tEff,
    });
  }
  neighbors.sort((a, b) => a.distancePc - b.distancePc);

  return {
    neighbors,
    positionsPc: new Float32Array(positions),
    colors: new Float32Array(colors),
    luminosities: new Float32Array(luminosities),
    seedHexes,
  };
}
