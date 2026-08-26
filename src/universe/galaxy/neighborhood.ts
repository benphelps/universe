import { buildTemperatureLut, temperatureToLutCoord } from '../../core/color/blackbody';
import { seedToHex } from '../../core/rng/hash';
import { starsNear } from './catalog';
import type { GalacticPosition } from './density';
import { rotateToScene, sceneFromGalaxy } from './orientation';
import { companionLuminosity, starPhotometry } from './photometry';
import { viewpointForSeed } from './sectors';

/** Matches the sky field's near radius so 3D points hand off to the backdrop. */
export const NEIGHBOR_RADIUS_PC = 30;

export interface Neighbor {
  seedHex: string;
  distancePc: number;
  luminosity: number;
  tEff: number;
  /** True galactic position — travel carries it so the destination
   *  system is built where the star actually is. */
  positionPc: GalacticPosition;
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
  /** Absolute galactic position per rendered point, xyz, aligned. */
  galacticPc: Float32Array;
}

/**
 * The resolved stellar neighborhood around a system: every catalog star
 * within the sky field's near radius, in scene-frame pc relative to the
 * home star (which is excluded — the system renders it for real).
 */
export function computeNeighborhood(
  seed: bigint,
  viewpoint: GalacticPosition = viewpointForSeed(seed),
): Neighborhood {
  const orientation = sceneFromGalaxy(seed);
  const lut = buildTemperatureLut(96);
  const positions: number[] = [];
  const colors: number[] = [];
  const luminosities: number[] = [];
  const galactic: number[] = [];
  const neighbors: Neighbor[] = [];
  const seedHexes: string[] = [];

  for (const slot of starsNear(viewpoint, NEIGHBOR_RADIUS_PC)) {
    const physical = starPhotometry(slot.seed, slot.positionPc);
    if (physical.luminosity <= 0) continue;
    const dx = slot.positionPc.xPc - viewpoint.xPc;
    const dy = slot.positionPc.yPc - viewpoint.yPc;
    const dz = slot.positionPc.zPc - viewpoint.zPc;
    // The home star itself (travel arrives exactly on a slot).
    if (dx * dx + dy * dy + dz * dz < 2.5e-5) continue;
    // Into this system's randomly-oriented scene frame, like the backdrop.
    positions.push(...rotateToScene(orientation, dx, dy, dz));
    const lutIndex = Math.min(95, Math.floor(temperatureToLutCoord(physical.tEff) * 95)) * 4;
    colors.push(lut[lutIndex], lut[lutIndex + 1], lut[lutIndex + 2]);
    // Unresolved binaries glint with the pair's combined light.
    luminosities.push(physical.luminosity + companionLuminosity(slot.seed, slot.positionPc));
    galactic.push(slot.positionPc.xPc, slot.positionPc.yPc, slot.positionPc.zPc);
    seedHexes.push(seedToHex(slot.seed));
    neighbors.push({
      seedHex: seedToHex(slot.seed),
      distancePc: Math.hypot(dx, dy, dz),
      luminosity: physical.luminosity,
      tEff: physical.tEff,
      positionPc: slot.positionPc,
    });
  }
  neighbors.sort((a, b) => a.distancePc - b.distancePc);

  return {
    neighbors,
    positionsPc: new Float32Array(positions),
    colors: new Float32Array(colors),
    luminosities: new Float32Array(luminosities),
    seedHexes,
    galacticPc: new Float32Array(galactic),
  };
}
