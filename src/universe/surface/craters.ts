import type { Vec3 } from '../../core/math/vec3';
import { deriveSeed, mix64, seedFromHex } from '../../core/rng/hash';

interface CraterBand {
  /** Lattice cell size in the cube embedding (sets crater spacing). */
  cellSize: number;
  /** Angular radius range, radians. */
  minRadius: number;
  maxRadius: number;
  /** Expected craters per cell at full density. */
  countScale: number;
}

/** Two size bands: sparse basin-scale craters and a dense small population. */
const BANDS: CraterBand[] = [
  { cellSize: 0.45, minRadius: 0.03, maxRadius: 0.1, countScale: 1 },
  { cellSize: 0.11, minRadius: 0.006, maxRadius: 0.025, countScale: 2 },
];

interface Crater {
  center: Vec3;
  angularRadius: number;
}

/**
 * Deterministic crater height contribution, meters. Craters live one
 * lattice apiece in a 3D grid over the unit-sphere embedding: any
 * direction consults its 27-cell neighborhood per size band, so the
 * field is pure, unbounded, and identical at every level of detail.
 * Depth follows the simple-crater depth/diameter ratio, flattening for
 * large complex craters; each has a raised rim.
 */
export function createCraterField(
  seedHex: string,
  radiusM: number,
  amplitude: number,
): (dir: Vec3, lodAngularRad?: number) => number {
  if (amplitude <= 0.005) return () => 0;
  const rootSeed = deriveSeed(seedFromHex(seedHex), 'craters');
  // Packed-integer keys: this cache is consulted 54× per height sample,
  // and string keys made it the single hottest cost of the whole field.
  const cache = new Map<number, Crater[]>();

  const cellCraters = (band: number, cx: number, cy: number, cz: number): Crater[] => {
    const key = ((band * 1024 + cx + 512) * 1024 + cy + 512) * 1024 + cz + 512;
    const cached = cache.get(key);
    if (cached) return cached;

    const spec = BANDS[band];
    const cellSeed = mix64(
      rootSeed ^
        ((BigInt(band) << 60n) |
          (BigInt(cx & 0xffff) << 40n) |
          (BigInt(cy & 0xffff) << 20n) |
          BigInt(cz & 0xffff)),
    );
    const unit = (channel: number): number =>
      Number(mix64(cellSeed ^ BigInt(channel)) & 0xfffffn) / 0xfffff;

    const craters: Crater[] = [];
    const count = Math.floor(unit(0) * (spec.countScale * amplitude * 2.2 + 0.5));
    for (let i = 0; i < count; i++) {
      const px = (cx + unit(1 + i * 4)) * spec.cellSize;
      const py = (cy + unit(2 + i * 4)) * spec.cellSize;
      const pz = (cz + unit(3 + i * 4)) * spec.cellSize;
      const length = Math.hypot(px, py, pz);
      if (length < 0.55 || length > 1.45) continue;
      craters.push({
        center: { x: px / length, y: py / length, z: pz / length },
        angularRadius:
          spec.minRadius * (spec.maxRadius / spec.minRadius) ** unit(4 + i * 4) ** 2,
      });
    }
    cache.set(key, craters);
    if (cache.size > 8000) cache.clear();
    return craters;
  };

  // Merged 27-cell neighborhoods keyed by the home cell: consecutive
  // height samples land in the same cell, so the whole gather is
  // usually one Map hit per band.
  const EMPTY: Crater[] = [];
  const hoodCache = new Map<number, Crater[]>();
  const neighborhood = (band: number, ix: number, iy: number, iz: number): Crater[] => {
    const key = ((band * 1024 + ix + 512) * 1024 + iy + 512) * 1024 + iz + 512;
    const cached = hoodCache.get(key);
    if (cached) return cached;
    let merged: Crater[] | null = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = cellCraters(band, ix + dx, iy + dy, iz + dz);
          if (cell.length === 0) continue;
          if (!merged) merged = [];
          for (const crater of cell) merged.push(crater);
        }
      }
    }
    const result = merged ?? EMPTY;
    hoodCache.set(key, result);
    if (hoodCache.size > 4000) hoodCache.clear();
    return result;
  };

  return (dir, lodAngularRad = 0) => {
    let height = 0;
    for (let band = 0; band < BANDS.length; band++) {
      // Skip bands whose craters are below the caller's resolution.
      if (lodAngularRad > 0 && BANDS[band].maxRadius < lodAngularRad * 1.5) continue;
      const size = BANDS[band].cellSize;
      const craters = neighborhood(
        band,
        Math.floor(dir.x / size),
        Math.floor(dir.y / size),
        Math.floor(dir.z / size),
      );
      for (const crater of craters) {
        // Under-resolved craters fade out: a bowl spanning two or
        // three vertices aliases into an angular blob.
        let fade = 1;
        if (lodAngularRad > 0) {
          const samplesAcross = crater.angularRadius / lodAngularRad;
          if (samplesAcross < 2.5) continue;
          fade = Math.min(1, (samplesAcross - 2.5) / 6);
        }
        const chordX = dir.x - crater.center.x;
        const chordY = dir.y - crater.center.y;
        const chordZ = dir.z - crater.center.z;
        const theta = Math.hypot(chordX, chordY, chordZ);
        const x = theta / crater.angularRadius;
        if (x >= 1.6) continue;
        height += craterProfile(x, crater.angularRadius, radiusM) * fade;
      }
    }
    return height;
  };
}

/**
 * Deepest possible crater excavation below the datum, meters — two of
 * the largest band's bowls stacked. Anything (like a depth-occlusion
 * proxy) that must sit below all terrain needs this budget on top of
 * the continental relief.
 */
export function maxCraterDepthM(radiusM: number, amplitude: number): number {
  if (amplitude <= 0.005) return 0;
  const maxDiameterM = 2 * BANDS[0].maxRadius * radiusM;
  return 2 * Math.min(0.2 * maxDiameterM, 3500 + 0.015 * maxDiameterM);
}

/** Bowl plus rim, meters, for normalized radial distance x = θ/r. */
function craterProfile(x: number, angularRadius: number, radiusM: number): number {
  const diameterM = 2 * angularRadius * radiusM;
  // Simple craters: depth ≈ D/5; complex craters flatten out.
  const depth = Math.min(0.2 * diameterM, 3500 + 0.015 * diameterM);
  const rimHeight = 0.3 * depth;
  const bowl = x < 1 ? depth * (x * x - 1) : 0;
  const rim = rimHeight * Math.exp(-((x - 1) * (x - 1)) / 0.06);
  return bowl + rim;
}
