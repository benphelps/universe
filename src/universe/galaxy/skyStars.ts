import { temperatureToLutCoord } from '../../core/color/blackbody';

/** The stars of a sky as they are gathered: one viewpoint's
 *  directions, colours, brightnesses, distances, temperatures and
 *  seeds, growing as cells are projected. */
export interface StarAccum {
  dirs: number[];
  colors: number[];
  brightness: number[];
  distances: number[];
  teffs: number[];
  seeds: bigint[];
}

export function makeAccum(): StarAccum {
  return { dirs: [], colors: [], brightness: [], distances: [], teffs: [], seeds: [] };
}

export function pushTo(
  acc: StarAccum,
  lut: Float32Array,
  dx: number,
  dy: number,
  dz: number,
  luminosity: number,
  tEff: number,
  starSeed: bigint,
): void {
  const distanceSq = dx * dx + dy * dy + dz * dz;
  if (distanceSq < 1e-6) return;
  const distance = Math.sqrt(distanceSq);
  const lutIndex = Math.min(95, Math.floor(temperatureToLutCoord(tEff) * 95)) * 4;
  acc.dirs.push(dx / distance, dy / distance, dz / distance);
  acc.colors.push(lut[lutIndex], lut[lutIndex + 1], lut[lutIndex + 2]);
  acc.brightness.push(luminosity / distanceSq);
  acc.distances.push(distance);
  acc.teffs.push(tEff);
  acc.seeds.push(starSeed);
}

/** A sweep result as transferable arrays. */
export interface PackedStars {
  dirs: Float32Array;
  colors: Float32Array;
  brightness: Float32Array;
  distances: Float32Array;
  teffs: Float32Array;
  seeds: BigUint64Array;
}

export interface SweepSlab {
  near: PackedStars;
  far: PackedStars;
}

export function packAccum(acc: StarAccum): PackedStars {
  return {
    dirs: new Float32Array(acc.dirs),
    colors: new Float32Array(acc.colors),
    brightness: new Float32Array(acc.brightness),
    distances: new Float32Array(acc.distances),
    teffs: new Float32Array(acc.teffs),
    seeds: BigUint64Array.from(acc.seeds),
  };
}

export function appendPacked(acc: StarAccum, packed: PackedStars): void {
  for (let i = 0; i < packed.dirs.length; i++) acc.dirs.push(packed.dirs[i]);
  for (let i = 0; i < packed.colors.length; i++) acc.colors.push(packed.colors[i]);
  for (let i = 0; i < packed.brightness.length; i++) {
    acc.brightness.push(packed.brightness[i]);
    acc.distances.push(packed.distances[i]);
    acc.teffs.push(packed.teffs[i]);
    acc.seeds.push(packed.seeds[i]);
  }
}
