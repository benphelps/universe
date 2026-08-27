import { buildTemperatureLut, temperatureToLutCoord } from '../../core/color/blackbody';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { armProfile, waveAxisRatio, waveTilt } from './density';

/**
 * The galaxy as a population of drawable particles — stars, dust
 * billows, dust filament chains, and H II regions — every one placed
 * on an orbit of the same density-wave family the smooth model rides
 * (vocabulary after beltoforion's renderer). Stars sampled uniformly
 * along the tilted ovals crowd exactly where the analytic field says
 * the arms are, so the particle image and the smooth density agree by
 * construction; the graininess, clumping, and broken patches the
 * smooth field cannot show are simply what the discreteness looks
 * like. Deterministic: one fixed seed, one galaxy.
 */
export interface GalaxyParticleSet {
  count: number;
  /** Galactic-frame positions, pc, xyz per particle. */
  positionsPc: Float32Array;
  /** Linear sRGB premultiplied by the particle's magnitude. */
  colors: Float32Array;
  /** World radius of the sprite, pc. */
  sizesPc: Float32Array;
  /** 0 star · 1 dust billow · 2 filament dust · 3 H2 glow · 4 H2 core. */
  types: Float32Array;
}

const GALAXY_RADIUS = 16000;
const STAR_COUNT = 85000;
const DUST_COUNT = 22000;
const FILAMENT_CHAINS = 650;
const H2_COUNT = 520;

/** Radial light profile the star sampler draws from: a de Vaucouleurs
 *  bulge blended into the thin disk's exponential. */
function radialIntensity(radiusPc: number): number {
  return Math.exp(-radiusPc / 2600) + 5.0 * Math.exp(-1.35 * (radiusPc / 90) ** 0.25);
}

/** Numeric inverse CDF of the radial profile (Simpson + resample). */
function buildRadialCdf(): (unit: number) => number {
  const steps = 1024;
  const h = GALAXY_RADIUS / steps;
  const cumulative = new Float64Array(steps + 1);
  for (let i = 1; i <= steps; i++) {
    const a = radialIntensity((i - 1) * h);
    const b = radialIntensity((i - 0.5) * h);
    const c = radialIntensity(i * h);
    cumulative[i] = cumulative[i - 1] + ((a + 4 * b + c) / 6) * h;
  }
  const total = cumulative[steps];
  return (unit: number) => {
    const target = unit * total;
    let lo = 0;
    let hi = steps;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid;
      else hi = mid;
    }
    const span = cumulative[hi] - cumulative[lo];
    return (lo + (span > 0 ? (target - cumulative[lo]) / span : 0)) * h;
  };
}

/** A point on the oval orbit of the given guiding radius. */
function placeOnOrbit(guidingPc: number, t: number): { x: number; y: number } {
  const q = waveAxisRatio(guidingPc);
  const tilt = waveTilt(guidingPc);
  const ex = guidingPc * Math.cos(t);
  const ey = guidingPc * q * Math.sin(t);
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return { x: ex * c - ey * s, y: ex * s + ey * c };
}

let cached: GalaxyParticleSet | null = null;

export function getGalaxyParticles(): GalaxyParticleSet {
  if (cached) return cached;
  const rng = new Rng(deriveSeed(0x47414c58n, 'galaxy-particles'));
  const cdf = buildRadialCdf();
  const lut = buildTemperatureLut(96);

  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const types: number[] = [];

  const push = (
    x: number,
    y: number,
    z: number,
    tempK: number,
    magnitude: number,
    sizePc: number,
    type: number,
  ): void => {
    const lutIndex = Math.min(95, Math.floor(temperatureToLutCoord(tempK) * 95)) * 4;
    positions.push(x, y, z);
    colors.push(
      lut[lutIndex] * magnitude,
      lut[lutIndex + 1] * magnitude,
      lut[lutIndex + 2] * magnitude,
    );
    sizes.push(sizePc);
    types.push(type);
  };

  const laplace = (scalePc: number): number => {
    const u = rng.float() - 0.5;
    return -scalePc * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  };

  // Stars: field population everywhere, with the young luminous
  // fraction accepted preferentially where the wave crowds — they are
  // born in the arms they light.
  for (let i = 0; i < STAR_COUNT; i++) {
    const guiding = cdf(rng.float());
    const t = rng.float() * 2 * Math.PI;
    const { x, y } = placeOnOrbit(guiding, t);
    const z = laplace(90 + 0.03 * guiding);
    let temp = 3600 + 3400 * rng.float() ** 2;
    let mag = 0.12 + 0.38 * rng.float() ** 3;
    let px = x;
    let py = y;
    const radius = Math.hypot(x, y);
    if (radius > 2500) {
      const { boost } = armProfile(radius, Math.atan2(y, x));
      if (rng.float() < boost / 3.5) {
        temp = 7000 + 9000 * rng.float();
        mag = Math.min(1, mag * 1.7 + 0.1);
        // Natal scatter: young stars drift off their birth caustic.
        px += (rng.float() - 0.5) * 320;
        py += (rng.float() - 0.5) * 320;
      }
    }
    push(px, py, z, temp, mag, 14 + 30 * mag, 0);
  }

  // Dust billows: huge, faint, additive — the luminous haze. Half
  // follow the light profile, half spread uniformly (the outskirts
  // keep a whisper of haze). Temperature runs warm inner to bluish
  // outer — beltoforion's gradient, kept because it reads right.
  for (let i = 0; i < DUST_COUNT; i++) {
    let guiding: number;
    if (i % 2 === 0) {
      guiding = cdf(rng.float());
    } else {
      const x = (2 * rng.float() - 1) * GALAXY_RADIUS;
      const y = (2 * rng.float() - 1) * GALAXY_RADIUS;
      guiding = Math.hypot(x, y);
      if (guiding > GALAXY_RADIUS) continue;
    }
    const t = rng.float() * 2 * Math.PI;
    const { x, y } = placeOnOrbit(guiding, t);
    const z = laplace(70 + 0.015 * guiding);
    const temp = 4000 + guiding / 4.5;
    const mag = 0.02 + 0.15 * rng.float();
    push(x, y, z, temp, mag, 380 + 520 * rng.float(), 1);
  }

  // Filament chains: clumped strings of smaller dust along one orbit —
  // the streaming debris differential rotation makes of any cloud.
  for (let chain = 0; chain < FILAMENT_CHAINS; chain++) {
    const x0 = (2 * rng.float() - 1) * GALAXY_RADIUS;
    const y0 = (2 * rng.float() - 1) * GALAXY_RADIUS;
    let guiding = Math.hypot(x0, y0);
    if (guiding > GALAXY_RADIUS || guiding < 600) continue;
    const t0 = rng.float() * 2 * Math.PI;
    const chainMag = 0.09 + 0.05 * rng.float();
    const members = Math.floor(6 + 54 * rng.float());
    for (let m = 0; m < members; m++) {
      guiding += (rng.float() - 0.5) * 380;
      const t = t0 + (rng.float() - 0.5) * 0.35;
      const { x, y } = placeOnOrbit(Math.max(500, guiding), t);
      const z = laplace(60);
      push(x, y, z, 3600 + guiding / 4.5, chainMag + 0.025 * rng.float(), 150 + 190 * rng.float(), 2);
    }
  }

  // H II regions: their size is the wave-spacing probe — where the
  // caustic packs adjacent orbits together, spacing shrinks and the
  // knot lights; in loose interarm space it never ignites.
  for (let i = 0; i < H2_COUNT; i++) {
    const x0 = (2 * rng.float() - 1) * GALAXY_RADIUS;
    const y0 = (2 * rng.float() - 1) * GALAXY_RADIUS;
    const guiding = Math.hypot(x0, y0);
    if (guiding > GALAXY_RADIUS || guiding < 2500) continue;
    const t = rng.float() * 2 * Math.PI;
    const inner = placeOnOrbit(guiding, t);
    const outer = placeOnOrbit(guiding + 800, t);
    const spacing = Math.hypot(outer.x - inner.x, outer.y - inner.y);
    const sizePc = (800 - spacing) * 0.55;
    if (sizePc < 45) continue;
    const z = laplace(55);
    const hx = inner.x + (rng.float() - 0.5) * 280;
    const hy = inner.y + (rng.float() - 0.5) * 280;
    const mag = 0.35 + 0.3 * rng.float();
    const [r, g, b] = [1.0, 0.32, 0.38];
    positions.push(hx, hy, z);
    colors.push(r * mag, g * mag, b * mag);
    sizes.push(Math.min(sizePc, 380));
    types.push(3);
    positions.push(hx, hy, z);
    colors.push(1, 0.94, 0.9);
    sizes.push(Math.min(sizePc, 380) * 0.2);
    types.push(4);
  }

  cached = {
    count: types.length,
    positionsPc: new Float32Array(positions),
    colors: new Float32Array(colors),
    sizesPc: new Float32Array(sizes),
    types: new Float32Array(types),
  };
  return cached;
}
