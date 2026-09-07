import { cloudLocalDensity } from './clouds';
import { hydrogenDensity } from './gas';
import { FRONT_AXES, FRONT_DIRECTIONS, nebulaGrowth, type Nebula } from './nebula';
import { SHELL_WIDTH, WIND_CAVITY_RESIDUAL, WIND_REACH, WIND_STALL, WIND_WALL_WIDTH } from './ionization';
import { shellMapRadius, type MaterialMap } from './gasRemap';

const COLS = 48, ROWS = 24;
export interface FeedbackProfile { front: Float32Array; windScale: Float32Array; maximumFrontPc: number }
const profiles = new WeakMap<Nebula, FeedbackProfile>();

/** Smooth the coarse directional expansion estimates on a periodic
 * spherical atlas. These prescribe motion; the final photon solve
 * determines the ionized region independently. */
export function nebulaFeedbackProfile(nebula: Nebula): FeedbackProfile {
  const prior = profiles.get(nebula);
  if (prior) return prior;
  const wind = new Float64Array(FRONT_DIRECTIONS);
  const source = nebula.sources[0];
  const radius = nebula.windCavityPc * Math.cbrt(nebulaGrowth(nebula).dilution);
  for (let i = 0; i < wind.length; i++) {
    const density = source ? hydrogenDensity(cloudLocalDensity(nebula.cloud,
      source.dxPc + radius * FRONT_AXES[3 * i], source.dyPc + radius * FRONT_AXES[3 * i + 1],
      source.dzPc + radius * FRONT_AXES[3 * i + 2]) * nebula.dustFactor, nebula.metallicity) : 0;
    wind[i] = Math.min(WIND_REACH, Math.max(WIND_STALL, (nebula.sourceHydrogenDensity / Math.max(1e-6, density)) ** 0.25));
  }
  const profile: FeedbackProfile = { front: new Float32Array(COLS * (ROWS + 1)), windScale: new Float32Array(COLS * (ROWS + 1)), maximumFrontPc: 0 };
  for (let row = 0; row <= ROWS; row++) for (let col = 0; col < COLS; col++) {
    const lat = (row / ROWS - 0.5) * Math.PI, lon = col / COLS * 2 * Math.PI;
    const x = Math.cos(lat) * Math.cos(lon), y = Math.cos(lat) * Math.sin(lon), z = Math.sin(lat);
    let total = 0, front = 0, cavity = 0;
    for (let i = 0; i < FRONT_DIRECTIONS; i++) {
      const dot = Math.max(0, x * FRONT_AXES[3 * i] + y * FRONT_AXES[3 * i + 1] + z * FRONT_AXES[3 * i + 2]);
      const weight = dot ** 32;
      total += weight; front += weight * nebula.frontPc[i]; cavity += weight * wind[i];
    }
    profile.front[row * COLS + col] = front / total;
    profile.windScale[row * COLS + col] = cavity / total;
    profile.maximumFrontPc = Math.max(profile.maximumFrontPc, profile.front[row * COLS + col]);
  }
  profiles.set(nebula, profile);
  return profile;
}

function at(values: Float32Array, x: number, y: number): number {
  const col = Math.floor(x), row = Math.min(ROWS - 1, Math.floor(y));
  const fx = x - col, fy = y - row;
  const a = values[row * COLS + col], b = values[row * COLS + (col + 1) % COLS];
  const c = values[(row + 1) * COLS + col], d = values[(row + 1) * COLS + (col + 1) % COLS];
  return (a + fx * (b - a)) * (1 - fy) + (c + fx * (d - c)) * fy;
}

export function feedbackRadii(profile: FeedbackProfile | undefined, x: number, y: number, z: number, bubble: number, wind: number): [number, number] {
  const r = Math.hypot(x, y, z);
  let front = bubble, scale = 1;
  if (profile && r > 0) {
    const u = ((Math.atan2(y, x) / (2 * Math.PI) + 1) % 1) * COLS;
    const v = (Math.asin(Math.max(-1, Math.min(1, z / r))) / Math.PI + 0.5) * ROWS;
    front = at(profile.front, u, v); scale = at(profile.windScale, u, v);
  }
  return [front, Math.min(wind * scale, front / (1 + WIND_WALL_WIDTH))];
}

export function feedbackMaterialMap(source: [number, number, number], bubble: number, dilution: number, wind: number, profile?: FeedbackProfile): MaterialMap {
  const maximum = (profile?.maximumFrontPc ?? bubble) * (1 + SHELL_WIDTH);
  const radiusAfter = (r: number, front: number, cavity: number): number => shellMapRadius(
    shellMapRadius(r, front, front * (1 + SHELL_WIDTH), dilution), cavity, cavity * (1 + WIND_WALL_WIDTH), WIND_CAVITY_RESIDUAL);
  return {
    subdivisions(x, y, z, cellPc) {
      const dx = x - source[0], dy = y - source[1], dz = z - source[2];
      const r = Math.hypot(dx, dy, dz), reach = cellPc * Math.sqrt(3) / 2;
      if (maximum <= 0 || r - reach >= maximum || (dilution >= 1 && wind <= 0)) return 0;
      const [front, cavity] = feedbackRadii(profile, dx, dy, dz, bubble, wind);
      const near = Math.max(1e-10, r - reach);
      const stretch = radiusAfter(near, front, cavity) / near;
      return Math.min(12, Math.max(2, Math.ceil(stretch * 1.2)));
    },
    move(x, y, z, result) {
      const dx = x - source[0], dy = y - source[1], dz = z - source[2], r = Math.hypot(dx, dy, dz);
      if (r === 0 || r >= maximum) { result[0] = x; result[1] = y; result[2] = z; return; }
      const [front, cavity] = feedbackRadii(profile, dx, dy, dz, bubble, wind);
      const moved = radiusAfter(r, front, cavity);
      if (moved === r) { result[0] = x; result[1] = y; result[2] = z; return; }
      const scale = moved / r;
      result[0] = source[0] + dx * scale; result[1] = source[1] + dy * scale; result[2] = source[2] + dz * scale;
    },
  };
}
