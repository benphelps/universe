import { deriveSeed, mix64, seedToHex } from '../../core/rng/hash';
import { poisson } from '../../core/rng/distributions';
import { Rng } from '../../core/rng/rng';
import { createSimplex3 } from '../../core/noise/simplex3';
import { cloudsInCell, type MolecularCloud } from './clouds';
import { nearestArm, stellarDensity, type GalacticPosition } from './density';
import { galaxySeed } from './galaxySeed';

/**
 * The galactic gazetteer: names for the structure the model already
 * carries, the way human astronomy named the Orion Arm or the Perseus
 * Arm. Chart sectors are the territories of real landmarks: each
 * province anchors on a prominent molecular-cloud complex — the same
 * first-class objects that carve the rifts and light the nebulae — and
 * a locale belongs to the nearest anchor through a mass-weighted,
 * noise-bent metric, so great complexes claim broad regions and the
 * borders settle organically between them. A province and its anchor
 * cloud share a seed, and therefore a name. Where the cloud population
 * thins out — the far rim, the halo — sparsely seeded frontier anchors
 * keep the map complete. Every chart of this universe agrees on every
 * border and every name.
 */

/** Anchor-search cell span (4 cloud cells; provinces are its scale). */
export const SECTOR_SITE_SPAN_PC = 1000;

let warpNoiseFn: ReturnType<typeof createSimplex3> | null = null;
function warpNoise(x: number, y: number, z: number): number {
  return (warpNoiseFn ??= createSimplex3(deriveSeed(galaxySeed(), 'sector-warp')))(x, y, z);
}
let siteSalt: bigint | null = null;
function siteSaltOf(): bigint {
  return (siteSalt ??= deriveSeed(galaxySeed(), 'sector-site'));
}

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

/**
 * A galaxy's own name, from the same phonology that names its arms and
 * sectors. Pure in the seed rather than in the session's galaxy, so a
 * mark can name the galaxy it belongs to without that galaxy ever
 * having been materialized.
 */
export function galaxyName(seed: bigint): string {
  return generatedName(deriveSeed(seed, 'galaxy-name'));
}

let armNames: string[] | null = null;
function armNamesOf(): string[] {
  return (armNames ??= [0, 1].map((arm) =>
    generatedName(deriveSeed(galaxySeed(), 'arm-name', arm)),
  ));
}

interface SectorSite {
  xPc: number;
  yPc: number;
  zPc: number;
  seed: bigint;
  /** Territorial reach: prominent complexes claim broader regions. */
  weight: number;
  /** Anchor cloud radius; 0 marks a jittered frontier filler. */
  radiusPc: number;
}

/** Landmark prominence: the cloud's excess dust mass, roughly. */
function cloudScore(cloud: MolecularCloud): number {
  return cloud.amplitude * cloud.radiusPc ** 3;
}

// Border tracing sweeps thousands of lookups over the same few hundred
// cells; the per-cell derivation is BigInt-priced, so memoize.
const siteCache = new Map<number, SectorSite[]>();

/** Score of a typical landmark cloud, for weight normalization. */
const SCORE_REF = 4.5 * 45 ** 3;
const CLOUD_CELLS_PER_SPAN = 4;

/**
 * The anchors of one span cell: its most prominent molecular clouds,
 * as many as the local stellar density warrants — so provinces run
 * small along the arms and inner disk and sprawl in the rim — with
 * jittered frontier anchors only where clouds are too sparse to carry
 * the map (the outer rim, the halo).
 */
function sitesFor(ix: number, iy: number, iz: number): SectorSite[] {
  const key = ((ix + 1024) * 2048 + (iy + 1024)) * 64 + (iz + 32);
  const cached = siteCache.get(key);
  if (cached) return cached;
  const cellSeed = mix64(
    siteSaltOf() ^
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

  const clouds: MolecularCloud[] = [];
  for (let cx = 0; cx < CLOUD_CELLS_PER_SPAN; cx++) {
    for (let cy = 0; cy < CLOUD_CELLS_PER_SPAN; cy++) {
      for (let cz = 0; cz < CLOUD_CELLS_PER_SPAN; cz++) {
        clouds.push(
          ...cloudsInCell(
            ix * CLOUD_CELLS_PER_SPAN + cx,
            iy * CLOUD_CELLS_PER_SPAN + cy,
            iz * CLOUD_CELLS_PER_SPAN + cz,
          ),
        );
      }
    }
  }
  clouds.sort((a, b) => cloudScore(b) - cloudScore(a));

  const sites: SectorSite[] = [];
  for (const cloud of clouds.slice(0, count)) {
    sites.push({
      xPc: cloud.positionPc.xPc,
      yPc: cloud.positionPc.yPc,
      zPc: cloud.positionPc.zPc,
      seed: cloud.seed,
      weight: Math.min(2.2, Math.max(0.6, (cloudScore(cloud) / SCORE_REF) ** (1 / 3))),
      radiusPc: cloud.radiusPc,
    });
  }
  for (let k = sites.length; k < count; k++) {
    sites.push({
      xPc: (ix + rng.float()) * SECTOR_SITE_SPAN_PC,
      yPc: (iy + rng.float()) * SECTOR_SITE_SPAN_PC,
      zPc: (iz + rng.float()) * SECTOR_SITE_SPAN_PC,
      seed: deriveSeed(cellSeed, 'site', k),
      weight: 0.8,
      radiusPc: 0,
    });
  }
  siteCache.set(key, sites);
  return sites;
}

/** Border-bending warp: territories meander instead of meeting on
 *  planes. Modest — the anchors themselves carry the real structure. */
function warped(xPc: number, yPc: number, zPc: number): [number, number, number] {
  const sx = xPc / 750;
  const sy = yPc / 750;
  const sz = zPc / 750;
  const fx = xPc / 270;
  const fy = yPc / 270;
  const fz = zPc / 270;
  return [
    xPc + 120 * warpNoise(sx, sy, sz) + 50 * warpNoise(fx, fy, fz + 11),
    yPc + 120 * warpNoise(sx, sy, sz + 101) + 50 * warpNoise(fx, fy, fz + 112),
    zPc + 120 * warpNoise(sx, sy, sz + 203) + 50 * warpNoise(fx, fy, fz + 214),
  ];
}

/** The territory a locale belongs to: the anchor whose weighted reach
 *  wins in the warped metric — a power diagram over the landmarks. */
export function sectorSeedAt(positionPc: GalacticPosition): bigint {
  const [wx, wy, wz] = warped(positionPc.xPc, positionPc.yPc, positionPc.zPc);
  const cx = Math.floor(wx / SECTOR_SITE_SPAN_PC);
  const cy = Math.floor(wy / SECTOR_SITE_SPAN_PC);
  const cz = Math.floor(wz / SECTOR_SITE_SPAN_PC);
  let best = 0n;
  let bestCost = Infinity;
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iy = cy - 1; iy <= cy + 1; iy++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        for (const site of sitesFor(ix, iy, iz)) {
          const cost =
            ((site.xPc - wx) ** 2 + (site.yPc - wy) ** 2 + (site.zPc - wz) ** 2) /
            site.weight;
          if (cost < bestCost) {
            bestCost = cost;
            best = site.seed;
          }
        }
      }
    }
  }
  return best;
}

/**
 * The galaxy's celestial landmarks: every province's anchor complex —
 * the prominent molecular clouds the gazetteer already names sectors
 * after — as travel destinations. Each carries a gateway system seeded
 * from its cloud, so arriving puts the complex overhead in that sky.
 * Deterministic and universal; expensive to enumerate (a full-disk
 * span sweep), so callers should hold the result or run it off-thread.
 */
export interface GalacticLandmark {
  name: string;
  positionPc: GalacticPosition;
  /** Territorial prominence (the anchor's site weight). */
  weight: number;
  /** Anchor cloud radius, pc. */
  radiusPc: number;
  /** Sector this landmark anchors (same name by construction). */
  sector: string;
  /** Gateway system inside the complex. */
  seedHex: string;
}

export function galacticLandmarks(): GalacticLandmark[] {
  const landmarks: GalacticLandmark[] = [];
  const spanRadius = Math.ceil(16000 / SECTOR_SITE_SPAN_PC);
  for (let ix = -spanRadius; ix < spanRadius; ix++) {
    for (let iy = -spanRadius; iy < spanRadius; iy++) {
      const centerX = (ix + 0.5) * SECTOR_SITE_SPAN_PC;
      const centerY = (iy + 0.5) * SECTOR_SITE_SPAN_PC;
      if (Math.hypot(centerX, centerY) > 16500) continue;
      for (let iz = -1; iz <= 0; iz++) {
        for (const site of sitesFor(ix, iy, iz)) {
          if (site.radiusPc <= 0) continue;
          const name = sectorNameForSeed(site.seed);
          landmarks.push({
            name,
            positionPc: { xPc: site.xPc, yPc: site.yPc, zPc: site.zPc },
            weight: site.weight,
            radiusPc: site.radiusPc,
            sector: name,
            seedHex: seedToHex(deriveSeed(site.seed, 'gateway')),
          });
        }
      }
    }
  }
  landmarks.sort((a, b) => b.weight - a.weight);
  return landmarks.slice(0, 240);
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
  const armName = armNamesOf()[arm.index];

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
            : `the gap between the ${armNamesOf()[0]} and ${armNamesOf()[1]} Arms`;

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
