import { deriveSeed, mix64 } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { createSimplex3 } from '../../core/noise/simplex3';
import { nearestArm, type GalacticPosition } from './density';
import { UNIVERSE_SEED } from './sectors';

/**
 * The galactic gazetteer: names for the structure the model already
 * carries, the way human astronomy named the Orion Arm or the Perseus
 * Arm. Chart sectors are organic territories, not a grid: one seed
 * site per span cell (jittered across the whole cell), each locale
 * belonging to its nearest site through a noise-warped metric — so
 * boundaries meander like hand-drawn provinces, yet every chart of
 * this universe agrees on every border and every name.
 */

/** Mean territory span; actual shapes are irregular Voronoi provinces. */
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
  seed: bigint;
}

// Border tracing sweeps thousands of lookups over the same few hundred
// sites; the per-cell derivation is BigInt-priced, so memoize.
const siteCache = new Map<number, SectorSite>();

function siteFor(ix: number, iy: number): SectorSite {
  const key = (ix + 2048) * 4096 + (iy + 2048);
  const cached = siteCache.get(key);
  if (cached) return cached;
  const seed = mix64(SITE_SALT ^ ((BigInt(ix & 0xfffff) << 20n) | BigInt(iy & 0xfffff)));
  const rng = new Rng(seed);
  const site: SectorSite = {
    xPc: (ix + rng.float()) * SECTOR_SITE_SPAN_PC,
    yPc: (iy + rng.float()) * SECTOR_SITE_SPAN_PC,
    seed,
  };
  siteCache.set(key, site);
  return site;
}

/** Border-bending warp: territories meander instead of meeting on lines. */
function warped(xPc: number, yPc: number): [number, number] {
  return [
    xPc +
      190 * warpNoise(xPc / 750, yPc / 750, 0) +
      75 * warpNoise(xPc / 270, yPc / 270, 11),
    yPc +
      190 * warpNoise(xPc / 750, yPc / 750, 101) +
      75 * warpNoise(xPc / 270, yPc / 270, 112),
  ];
}

/** The territory a locale belongs to: nearest site in the warped metric. */
export function sectorSeedAt(positionPc: GalacticPosition): bigint {
  const [wx, wy] = warped(positionPc.xPc, positionPc.yPc);
  const cx = Math.floor(wx / SECTOR_SITE_SPAN_PC);
  const cy = Math.floor(wy / SECTOR_SITE_SPAN_PC);
  let best = 0n;
  let bestSq = Infinity;
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iy = cy - 2; iy <= cy + 2; iy++) {
      const site = siteFor(ix, iy);
      const dSq = (site.xPc - wx) ** 2 + (site.yPc - wy) ** 2;
      if (dSq < bestSq) {
        bestSq = dSq;
        best = site.seed;
      }
    }
  }
  return best;
}

/** Name of the territory containing a galactic position. */
export function sectorName(positionPc: GalacticPosition): string {
  return generatedName(deriveSeed(sectorSeedAt(positionPc), 'name'));
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
