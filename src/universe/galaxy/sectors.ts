import { poisson } from '../../core/rng/distributions';
import { deriveSeed, mix64 } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { stellarDensity, type GalacticPosition } from './density';

export const SECTOR_PC = 10;

/** The single shared universe every seed lives in. */
export const UNIVERSE_SEED = 0x53494d5f554e4956n;

export interface StarSlot {
  seed: bigint;
  positionPc: GalacticPosition;
}

/** Deterministic seed for the sector at integer coordinates. */
export function sectorSeed(ix: number, iy: number, iz: number): bigint {
  return mix64(
    deriveSeed(UNIVERSE_SEED, 'sector') ^
      ((BigInt(ix & 0xfffff) << 42n) | (BigInt(iy & 0xfffff) << 22n) | BigInt(iz & 0x3fffff)),
  );
}

/**
 * The stars of one 10 pc sector: count drawn Poisson from the local
 * density, positions uniform within the cube. Any sector materializes
 * independently, in any order, always identically.
 */
export function sectorStars(ix: number, iy: number, iz: number): StarSlot[] {
  const seed = sectorSeed(ix, iy, iz);
  const rng = new Rng(seed);
  const center: GalacticPosition = {
    xPc: (ix + 0.5) * SECTOR_PC,
    yPc: (iy + 0.5) * SECTOR_PC,
    zPc: (iz + 0.5) * SECTOR_PC,
  };
  const expected = stellarDensity(center) * SECTOR_PC ** 3;
  const count = poisson(rng, expected);

  const slots: StarSlot[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({
      seed: deriveSeed(seed, 'star', i),
      positionPc: {
        xPc: (ix + rng.float()) * SECTOR_PC,
        yPc: (iy + rng.float()) * SECTOR_PC,
        zPc: (iz + rng.float()) * SECTOR_PC,
      },
    });
  }
  return slots;
}

/** All star slots within radiusPc of a point (sector-grid sweep). */
export function starsNear(positionPc: GalacticPosition, radiusPc: number): StarSlot[] {
  const slots: StarSlot[] = [];
  const min = [
    Math.floor((positionPc.xPc - radiusPc) / SECTOR_PC),
    Math.floor((positionPc.yPc - radiusPc) / SECTOR_PC),
    Math.floor((positionPc.zPc - radiusPc) / SECTOR_PC),
  ];
  const max = [
    Math.floor((positionPc.xPc + radiusPc) / SECTOR_PC),
    Math.floor((positionPc.yPc + radiusPc) / SECTOR_PC),
    Math.floor((positionPc.zPc + radiusPc) / SECTOR_PC),
  ];
  const radiusSq = radiusPc * radiusPc;
  for (let ix = min[0]; ix <= max[0]; ix++) {
    for (let iy = min[1]; iy <= max[1]; iy++) {
      for (let iz = min[2]; iz <= max[2]; iz++) {
        for (const slot of sectorStars(ix, iy, iz)) {
          const dx = slot.positionPc.xPc - positionPc.xPc;
          const dy = slot.positionPc.yPc - positionPc.yPc;
          const dz = slot.positionPc.zPc - positionPc.zPc;
          if (dx * dx + dy * dy + dz * dz <= radiusSq) slots.push(slot);
        }
      }
    }
  }
  return slots;
}

/**
 * Deterministic locale for an arbitrary star seed: anywhere in the
 * inhabited disk — any galactocentric radius in the stellar belt, any
 * azimuth, settled toward the midplane. Band brightness, bulge
 * prominence, rift patterns, and the population mix all follow from
 * where the system actually sits.
 */
export function viewpointForSeed(seed: bigint): GalacticPosition {
  const unit = (channel: number): number =>
    Number(mix64(seed ^ deriveSeed(UNIVERSE_SEED, 'viewpoint', channel)) & 0xfffffn) / 0xfffff;
  const radius = 5200 + 6800 * unit(0);
  const azimuth = unit(1) * 2 * Math.PI;
  const settled = unit(2) * 2 - 1;
  return {
    xPc: radius * Math.cos(azimuth),
    yPc: radius * Math.sin(azimuth),
    zPc: settled * Math.abs(settled) * 350 + 15,
  };
}
