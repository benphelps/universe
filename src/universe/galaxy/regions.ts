import { deriveSeed, mix64 } from '../../core/rng/hash';
import { poisson } from '../../core/rng/distributions';
import { Rng } from '../../core/rng/rng';
import { createSimplex3 } from '../../core/noise/simplex3';
import { nearestArm, stellarDensity, type GalacticPosition } from './density';
import { UNIVERSE_SEED } from './sectors';

/**
 * The galactic gazetteer: names for the structure the model already
 * carries, the way human astronomy named the Orion Arm or the Perseus
 * Arm. Chart sectors are organic 3D territories, not a grid: one seed
 * site per span cell (jittered across the whole cell, in all three
 * axes), each locale belonging to the nearest of its 27 neighboring
 * sites through a noise-warped metric — so borders meander like
 * hand-drawn provinces and stack in shells above the disk, yet every
 * chart of this universe agrees on every border and every name.
 */

/** Mean territory span; actual shapes are irregular Voronoi volumes. */
export const SECTOR_SITE_SPAN_PC = 900;

const warpNoise = createSimplex3(deriveSeed(UNIVERSE_SEED, 'sector-warp'));
const SITE_SALT = deriveSeed(UNIVERSE_SEED, 'sector-site');

const ONSETS = [
  'k', 'v', 't', 's', 'th', 'r', 'm', 'n', 'd', 'l', 'z', 'b',
  'br', 'kr', 'dr', 'vel', 'mar', 'tal', 'or', 'ash',
];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'ia', 'ya', 'ou'];
const CODAS = ['', '', '', 'n', 'r', 's', 'l', 'th', 'k', 'x', 'm'];

/** Deterministic proper name from a seed (shared by arms and sectors). */
export function generatedName(seed: bigint): string {
  const rng = new Rng(seed);
  const syllables = rng.float() < 0.35 ? 3 : 2;
  let name = '';
  for (let i = 0; i < syllables; i++) {
    name += ONSETS[rng.int(ONSETS.length)] + NUCLEI[rng.int(NUCLEI.length)];
  }
  name += CODAS[rng.int(CODAS.length)];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const ARM_NAMES = [0, 1].map((arm) => generatedName(deriveSeed(UNIVERSE_SEED, 'arm-name', arm)));

interface SectorSite {
  xPc: number;
  yPc: number;
  zPc: number;
  seed: bigint;
}

// Border tracing sweeps thousands of lookups over the same few hundred
// cells; the per-cell derivation is BigInt-priced, so memoize.
const siteCache = new Map<number, SectorSite[]>();

/**
 * The sites of one span cell: at least one, plus extras where the
 * stellar density runs high — so provinces come out small along the
 * arms and in the inner disk, and sprawl in the rim and halo, the way
 * human administrative maps subdivide where the population is.
 */
function sitesFor(ix: number, iy: number, iz: number): SectorSite[] {
  const key = ((ix + 1024) * 2048 + (iy + 1024)) * 64 + (iz + 32);
  const cached = siteCache.get(key);
  if (cached) return cached;
  const cellSeed = mix64(
    SITE_SALT ^
      ((BigInt(ix & 0x3ffff) << 30n) | (BigInt(iy & 0x3ffff) << 12n) | BigInt(iz & 0xfff)),
  );
  const rng = new Rng(cellSeed);
  const density = stellarDensity({
    xPc: (ix + 0.5) * SECTOR_SITE_SPAN_PC,
    yPc: (iy + 0.5) * SECTOR_SITE_SPAN_PC,
    zPc: (iz + 0.5) * SECTOR_SITE_SPAN_PC,
  });
  const count = Math.min(
    6,
    1 + poisson(rng, Math.max(0, 2 * Math.sqrt(density / 0.1) - 1)),
  );
  const sites: SectorSite[] = [];
  for (let k = 0; k < count; k++) {
    sites.push({
      xPc: (ix + rng.float()) * SECTOR_SITE_SPAN_PC,
      yPc: (iy + rng.float()) * SECTOR_SITE_SPAN_PC,
      zPc: (iz + rng.float()) * SECTOR_SITE_SPAN_PC,
      seed: deriveSeed(cellSeed, 'site', k),
    });
  }
  siteCache.set(key, sites);
  return sites;
}

/** Border-bending warp: territories meander instead of meeting on planes. */
function warped(xPc: number, yPc: number, zPc: number): [number, number, number] {
  const sx = xPc / 750;
  const sy = yPc / 750;
  const sz = zPc / 750;
  const fx = xPc / 270;
  const fy = yPc / 270;
  const fz = zPc / 270;
  return [
    xPc + 190 * warpNoise(sx, sy, sz) + 75 * warpNoise(fx, fy, fz + 11),
    yPc + 190 * warpNoise(sx, sy, sz + 101) + 75 * warpNoise(fx, fy, fz + 112),
    zPc + 190 * warpNoise(sx, sy, sz + 203) + 75 * warpNoise(fx, fy, fz + 214),
  ];
}

/** The territory a locale belongs to: nearest site in the warped metric. */
export function sectorSeedAt(positionPc: GalacticPosition): bigint {
  const [wx, wy, wz] = warped(positionPc.xPc, positionPc.yPc, positionPc.zPc);
  const cx = Math.floor(wx / SECTOR_SITE_SPAN_PC);
  const cy = Math.floor(wy / SECTOR_SITE_SPAN_PC);
  const cz = Math.floor(wz / SECTOR_SITE_SPAN_PC);
  let best = 0n;
  let bestSq = Infinity;
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iy = cy - 1; iy <= cy + 1; iy++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        for (const site of sitesFor(ix, iy, iz)) {
          const dSq = (site.xPc - wx) ** 2 + (site.yPc - wy) ** 2 + (site.zPc - wz) ** 2;
          if (dSq < bestSq) {
            bestSq = dSq;
            best = site.seed;
          }
        }
      }
    }
  }
  return best;
}

/** Proper name of the territory a site seed identifies. */
export function sectorNameForSeed(seed: bigint): string {
  return generatedName(deriveSeed(seed, 'name'));
}

/** Name of the territory containing a galactic position. */
export function sectorName(positionPc: GalacticPosition): string {
  return sectorNameForSeed(sectorSeedAt(positionPc));
}

export interface GalacticAddress {
  /** Chart territory holding the locale. */
  sector: string;
  /** Broad structural zone the density model defines. */
  zone: 'core' | 'arm' | 'inter-arm' | 'rim' | 'halo';
  /** Proper name of the nearest spiral arm. */
  arm: string;
  radiusPc: number;
  /** Height above (+) or below (−) the midplane. */
  heightPc: number;
  /** One-line address for panels: sector, then the structural region. */
  label: string;
}

/** Where a locale sits in the galaxy, in chartable, nameable terms. */
export function galacticAddress(positionPc: GalacticPosition): GalacticAddress {
  const radiusPc = Math.hypot(positionPc.xPc, positionPc.yPc);
  const heightPc = positionPc.zPc;
  const azimuth = Math.atan2(positionPc.yPc, positionPc.xPc);
  const arm = nearestArm(radiusPc, azimuth);
  const armName = ARM_NAMES[arm.index];

  const zone: GalacticAddress['zone'] =
    Math.abs(heightPc) > 1200
      ? 'halo'
      : radiusPc < 1500
        ? 'core'
        : radiusPc > 13000
          ? 'rim'
          : arm.distancePc < 700
            ? 'arm'
            : 'inter-arm';

  const region =
    zone === 'halo'
      ? `the halo ${heightPc > 0 ? 'above' : 'below'} the disk`
      : zone === 'core'
        ? 'the galactic core'
        : zone === 'rim'
          ? 'the outer rim'
          : zone === 'arm'
            ? `the ${armName} Arm`
            : `the gap between the ${ARM_NAMES[0]} and ${ARM_NAMES[1]} Arms`;

  const sector = sectorName(positionPc);
  return {
    sector,
    zone,
    arm: armName,
    radiusPc,
    heightPc,
    label: `${sector} Sector · ${region} · ${(radiusPc / 1000).toFixed(1)} kpc from the core`,
  };
}
