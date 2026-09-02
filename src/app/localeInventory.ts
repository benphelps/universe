import { seedToHex } from '../core/rng/hash';
import { starsNear } from '../universe/galaxy/catalog';
import { cloudReachPc, cloudsNear, type MolecularCloud } from '../universe/galaxy/clouds';
import { clustersNear } from '../universe/galaxy/clusters';
import type { GalacticPosition } from '../universe/galaxy/density';
import { nebulaFor, type NebulaKind } from '../universe/galaxy/nebula';
import { sectorNameForSeed, sectorSeedAt, sectorSiteAt } from '../universe/galaxy/regions';

/** How far around the locale the nebula rung looks, pc. */
export const NEAR_CLOUD_REACH_PC = 300;
/** How far around a sector's anchor its province is swept for
 *  members, pc: provinces are sized by a thousand-parsec cell, and the
 *  ones out on the rim sprawl past it. */
const SECTOR_SWEEP_PC = 700;
/** The search for a cluster's gateway star widens until one is found. */
const GATEWAY_RADII_PC = [4, 8, 16, 32, 64];

/** A molecular cloud as a destination: what it is, how big, how far. */
export interface CloudEntry {
  seedHex: string;
  name: string;
  kind: NebulaKind;
  spanPc: number;
  distancePc: number;
  positionPc: GalacticPosition;
  ionizingStars: number;
}

/** An open cluster as a destination — visited from the nearest
 *  catalog star to its core, resolved on travel. */
export interface ClusterEntry {
  positionPc: GalacticPosition;
  richness: number;
  ageGyr: number;
  coreRadiusPc: number;
  distancePc: number;
}

export interface SectorInventory {
  /** The complex the sector is named after; null for a frontier
   *  province with no cloud of its own. */
  anchor: CloudEntry | null;
  /** Every cloud the sector's territory holds, nearest first. */
  clouds: CloudEntry[];
  clusters: ClusterEntry[];
}

/** What stands around a locale: its sector's holdings, and the clouds
 *  within the nebula rung's reach. */
export interface LocaleInventory {
  sector: SectorInventory;
  nearClouds: CloudEntry[];
}

function distance(a: GalacticPosition, b: GalacticPosition): number {
  return Math.hypot(a.xPc - b.xPc, a.yPc - b.yPc, a.zPc - b.zPc);
}

function cloudEntry(cloud: MolecularCloud, from: GalacticPosition): CloudEntry {
  const nebula = nebulaFor(cloud);
  return {
    seedHex: seedToHex(cloud.seed),
    name: sectorNameForSeed(cloud.seed),
    kind: nebula?.kind ?? 'dark',
    spanPc: 2 * cloudReachPc(cloud),
    distancePc: distance(cloud.positionPc, from),
    positionPc: cloud.positionPc,
    ionizingStars: nebula?.sources.length ?? 0,
  };
}

function byDistance<T extends { distancePc: number }>(a: T, b: T): number {
  return a.distancePc - b.distancePc;
}

/**
 * Chart what a locale stands among. The sector's members are the
 * clouds and clusters its territory claims, swept around the anchor
 * rather than the locale so a province reads the same from every
 * system inside it; the near clouds are simply the nearest.
 */
export function chartLocale(localePc: GalacticPosition): LocaleInventory {
  const site = sectorSiteAt(localePc);
  const anchorPc = { xPc: site.xPc, yPc: site.yPc, zPc: site.zPc };
  const held = cloudsNear(anchorPc, SECTOR_SWEEP_PC).filter(
    (cloud) => sectorSeedAt(cloud.positionPc) === site.seed,
  );
  // A province and its anchor cloud share a seed.
  const anchor = held.find((cloud) => cloud.seed === site.seed) ?? null;
  const clusters = clustersNear(anchorPc, SECTOR_SWEEP_PC)
    .filter((cluster) => sectorSeedAt(cluster.positionPc) === site.seed)
    .map((cluster) => ({
      positionPc: cluster.positionPc,
      richness: cluster.richness,
      ageGyr: cluster.ageGyr,
      coreRadiusPc: cluster.coreRadiusPc,
      distancePc: distance(cluster.positionPc, localePc),
    }))
    .sort(byDistance);
  return {
    sector: {
      anchor: anchor ? cloudEntry(anchor, localePc) : null,
      clouds: held.map((cloud) => cloudEntry(cloud, localePc)).sort(byDistance),
      clusters,
    },
    nearClouds: cloudsNear(localePc, NEAR_CLOUD_REACH_PC)
      .map((cloud) => cloudEntry(cloud, localePc))
      .sort(byDistance),
  };
}

/** The nearest catalog star to a point — where a cluster is visited
 *  from, since its own members carry no seeds of their own. */
export function nearestStar(
  positionPc: GalacticPosition,
): { seedHex: string; positionPc: GalacticPosition } | null {
  for (const radiusPc of GATEWAY_RADII_PC) {
    let best: { seedHex: string; positionPc: GalacticPosition } | null = null;
    let bestDistance = Infinity;
    for (const star of starsNear(positionPc, radiusPc)) {
      const d = distance(star.positionPc, positionPc);
      if (d >= bestDistance) continue;
      bestDistance = d;
      best = { seedHex: seedToHex(star.seed), positionPc: star.positionPc };
    }
    if (best) return best;
  }
  return null;
}
