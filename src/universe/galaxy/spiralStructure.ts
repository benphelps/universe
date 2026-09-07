import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { galaxySeed } from './galaxySeed';

/** Static morphology prescription, not a stellar orbit or gas-dynamics solve.
 * Arms redistribute each annulus: every compact ridge has its exact angular
 * mean subtracted. Stars and dust therefore keep their radial inventories. */
export const SPIRAL_LIMITS = {
  radiusMaxPc: 24000,
  radialStepPc: 40,
  starWeight: 5,
  dustWeight: 4.8,
  starWidthMaxRad: 0.65,
  dustWidthMaxRad: 0.3,
} as const;
const TAU = 2 * Math.PI;
// Mean over 2π of (1 - (θ/w)²)³ on |θ| < w is 16w/(35π).
const KERNEL_MEAN = 16 / (35 * Math.PI);
const STRIDE = 6;
const ROWS = SPIRAL_LIMITS.radiusMaxPc / SPIRAL_LIMITS.radialStepPc + 1;

export interface SpiralArm {
  readonly index: number;
  readonly startPc: number;
  readonly endPc: number;
  readonly phase: number;
  readonly pitchDegrees: readonly number[];
  readonly widthPc: number;
}
interface Spine {
  parent: number;
  kind: 'arm' | 'branch' | 'bar';
  /** Unwrapped angle, stellar/dust half-width, stellar/dust amplitude,
   * dust offset. Linear radial interpolation preserves the density bounds. */
  rows: Float64Array;
}
export type SpiralFamily = 'grand-design' | 'multi-arm' | 'flocculent';
export interface SpiralStructure {
  readonly family: SpiralFamily;
  readonly barRadiusPc: number;
  readonly arms: readonly SpiralArm[];
  readonly spines: readonly Spine[];
  /** Finite line segments used only for named-region distances. */
  readonly segments: readonly { parent: number; x: number; y: number; dx: number; dy: number; length2: number }[];
}
const smooth = (v: number): number => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
function series(values: readonly number[], radiusPc: number, spacingPc = 2000): number {
  const u = Math.max(0, Math.min(values.length - 1, radiusPc / spacingPc));
  const i = Math.min(values.length - 2, Math.floor(u));
  return values[i] + (values[i + 1] - values[i]) * smooth(u - i);
}
function kernel(delta: number, width: number): number {
  const t = (delta - TAU * Math.floor((delta + Math.PI) / TAU)) / width;
  if (t <= -1 || t >= 1) return 0;
  const v = 1 - t * t;
  return v * v * v;
}

/** Explicit seed entry point permits population audits without session resets. */
export function buildSpiralStructure(seed: bigint): SpiralStructure {
  const rng = new Rng(deriveSeed(seed, 'spiral-structure-v2'));
  // Deliberately broad fictional-catalogue diversity, not an observed
  // frequency distribution. Family controls topology, not just a noise seed.
  const family = (['grand-design', 'multi-arm', 'flocculent'] as const)[rng.int(3)];
  const count = family === 'grand-design' ? 2 : family === 'multi-arm' ? 3 + rng.int(3) : 6 + rng.int(4);
  const branchesPerArm = family === 'grand-design' ? 3 : family === 'multi-arm' ? 2 : 1;
  const barRadiusPc = rng.bool(family === 'flocculent' ? 0.15 : 0.55) ? rng.range(2200, 4800) : 0;
  const phase = rng.range(-Math.PI, Math.PI);
  const basePitch = rng.range(16, 31);
  const arms: SpiralArm[] = [];
  const spines: Spine[] = [];
  const segments: SpiralStructure['segments'][number][] = [];
  const weights = Array.from({ length: count }, () => rng.range(0.7, 1.3));
  const total = weights.reduce((a, b) => a + b, 0);
  // Most old stellar contrast belongs to long arms; gas/dust has a larger
  // allocation to branches. Sum of all amplitudes never exceeds its budget.
  const branchCount = branchesPerArm * count;
  for (let a = 0; a < count; a++) {
    const pitch = family === 'flocculent' ? rng.range(14, 36) : basePitch + rng.range(-3, 3);
    const connected = barRadiusPc > 0 && a < 2 && family !== 'flocculent';
    const startPc = connected ? barRadiusPc - 700 : family === 'flocculent' ? 1700 + 11500 * rng.float() ** 1.6 : rng.range(1500, 3700);
    const arm: SpiralArm = {
      index: a, startPc,
      endPc: family === 'flocculent' ? Math.min(22500, startPc + rng.range(3400, 7400)) : rng.range(12500, 22500),
      phase: connected ? phase + Math.PI * a : phase + TAU * a / count + rng.range(-0.6, 0.6),
      pitchDegrees: Array.from({ length: 13 }, () => rng.range(Math.max(9, pitch - 8), pitch + 8)),
      widthPc: family === 'flocculent' ? rng.range(800, 1700) : rng.range(1200, 2600),
    };
    arms.push(arm);
    const widths = Array.from({ length: 13 }, () => rng.range(0.65, 1.35));
    const gaps = Array.from({ length: 25 }, () => rng.float());
    const offsets = Array.from({ length: 13 }, () => rng.range(-180, 180));
    const fineBends = Array.from({ length: 61 }, () => rng.range(-100, 100));
    const laneBends = Array.from({ length: 81 }, () => rng.range(-190, 190));
    const laneWidths = Array.from({ length: 49 }, () => rng.range(0.55, 1.3));
    const patchSpacing = family === 'grand-design' ? 1300 : family === 'multi-arm' ? 1000 : 700;
    const rows = new Float64Array(ROWS * STRIDE);
    let angle = arm.phase;
    for (let i = 0; i < ROWS; i++) {
      const r = i * SPIRAL_LIMITS.radialStepPc;
      const pitchRad = series(arm.pitchDegrees, r) * Math.PI / 180;
      if (i > 1) angle += Math.log(i / (i - 1)) / Math.tan(series(arm.pitchDegrees, r - 20) * Math.PI / 180) *
        (connected ? smooth((r - 20 - barRadiusPc) / 900) : 1);
      const envelope = smooth((r - arm.startPc) / (family === 'flocculent' ? 700 : 1400)) * smooth((arm.endPc - r) / (family === 'flocculent' ? 1200 : 2600));
      const patch = series(gaps, r, patchSpacing);
      const width = arm.widthPc * series(widths, r) / Math.max(1, r * Math.sin(pitchRad));
      const j = i * STRIDE;
      rows[j] = angle + series(fineBends, r, 400) / Math.max(1000, r * Math.sin(pitchRad)) * (connected ? smooth((r - barRadiusPc) / 900) : 1);
      rows[j + 1] = Math.min(SPIRAL_LIMITS.starWidthMaxRad, width);
      rows[j + 2] = Math.min(SPIRAL_LIMITS.dustWidthMaxRad, width * 0.35 * series(laneWidths, r, 500));
      rows[j + 3] = 4.1 * weights[a] / total * envelope * (family === 'grand-design' ? 0.55 + 0.45 * patch : 0.15 + 0.85 * patch) * (family === 'flocculent' ? 2.6 : 1);
      rows[j + 4] = 2.8 * weights[a] / total * envelope * (0.02 + 0.98 * patch ** 3) * (family === 'flocculent' ? 3 : 1);
      // A varying offset is a morphology prescription, not a universal shock
      // upstream of corotation. Branches share the parent's local environment.
      rows[j + 5] = (series(offsets, r) + series(laneBends, r, 300)) / Math.max(1000, r * Math.sin(pitchRad));
    }
    const anchor = (connected ? barRadiusPc : arm.startPc) / SPIRAL_LIMITS.radialStepPc;
    const anchorLo = Math.floor(anchor) * STRIDE;
    const angleShift = arm.phase - (rows[anchorLo] + (rows[anchorLo + STRIDE] - rows[anchorLo]) * (anchor % 1));
    for (let i = 0; i < ROWS; i++) rows[i * STRIDE] += angleShift;
    spines.push({ parent: a, kind: 'arm', rows });
    for (let b = 0; b < branchesPerArm; b++) {
      const start = arm.startPc + (arm.endPc - arm.startPc) * (0.18 + b * 0.2) + rng.range(-250, 250);
      const end = Math.min(arm.endPc + 600, start + rng.range(2600, 5700));
      const startRow = start / SPIRAL_LIMITS.radialStepPc;
      const lo = Math.floor(startRow) * STRIDE;
      const theta0 = rows[lo] + (rows[lo + STRIDE] - rows[lo]) * (startRow % 1);
      const branchPitch = rng.range(28, 48) * Math.PI / 180;
      const bend = rng.range(-0.35, 0.35);
      const branchBends = Array.from({ length: 49 }, () => rng.range(-130, 130));
      const branchRows = new Float64Array(ROWS * STRIDE);
      for (let i = 0; i < ROWS; i++) {
        const r = i * SPIRAL_LIMITS.radialStepPc, j = i * STRIDE;
        const t = Math.max(0, Math.min(1, (r - start) / (end - start)));
        const envelope = smooth((r - start) / 700) * smooth((end - r) / 1200);
        const patch = series(gaps, r + 450, patchSpacing);
        branchRows[j] = theta0 + Math.log(Math.max(1, r) / start) / Math.tan(branchPitch) + bend * Math.sin(Math.PI * t);
        branchRows[j + 1] = Math.min(SPIRAL_LIMITS.starWidthMaxRad, arm.widthPc * 0.65 / Math.max(1, r * Math.sin(branchPitch)));
        branchRows[j + 2] = Math.min(SPIRAL_LIMITS.dustWidthMaxRad, branchRows[j + 1] * 0.45 * series(laneWidths, r + 200, 500));
        branchRows[j + 3] = 0.9 / branchCount * envelope * (0.4 + 0.6 * patch) * (family === 'flocculent' ? 2.6 : 1);
        branchRows[j + 4] = 2 / branchCount * envelope * (0.15 + 0.85 * patch) * (family === 'flocculent' ? 3 : 1);
        branchRows[j + 5] = series(branchBends, r, 500) / Math.max(1000, r * Math.sin(branchPitch));
      }
      spines.push({ parent: a, kind: 'branch', rows: branchRows });
    }
  }
  if (barRadiusPc > 0) {
    const barWidthPc = rng.range(500, 1000);
    for (let side = 0; side < 2; side++) {
      const rows = new Float64Array(ROWS * STRIDE);
      for (let i = 0; i < ROWS; i++) {
        const r = i * SPIRAL_LIMITS.radialStepPc, j = i * STRIDE;
        const envelope = smooth((r - 700) / 800) * smooth((barRadiusPc + 900 - r) / 1300);
        rows[j] = phase + side * Math.PI;
        rows[j + 1] = Math.min(SPIRAL_LIMITS.starWidthMaxRad, barWidthPc / Math.max(1, r));
        rows[j + 2] = Math.min(SPIRAL_LIMITS.dustWidthMaxRad, rows[j + 1] * 0.35);
        rows[j + 3] = 1.8 * envelope;
        rows[j + 4] = 0.7 * envelope;
        rows[j + 5] = rows[j + 1] * 0.5;
      }
      spines.push({ parent: side, kind: 'bar', rows });
    }
  }
  // Overlapping short segments and bar/arm joins share a per-ring amplitude
  // budget. Linear interpolation of these bounded rows remains bounded; no
  // clipping of the final field can spoil the zero-mean redistribution.
  for (let i = 0; i < ROWS; i++) {
    const j = i * STRIDE;
    let stars = 0, dust = 0;
    for (const spine of spines) { stars += spine.rows[j + 3]; dust += spine.rows[j + 4]; }
    const starScale = Math.min(1, SPIRAL_LIMITS.starWeight / stars);
    const dustScale = Math.min(1, SPIRAL_LIMITS.dustWeight / dust);
    for (const spine of spines) { spine.rows[j + 3] *= starScale; spine.rows[j + 4] *= dustScale; }
  }
  // Piecewise linear spatial distances include finite endpoints and branches.
  // 160 pc chords keep the naming error far below the 700 pc region threshold.
  for (const spine of spines) {
    for (let i = 4; i < ROWS; i += 4) {
      const j = i * STRIDE, k = (i - 4) * STRIDE;
      if (spine.rows[j + 3] < 0.015 || spine.rows[k + 3] < 0.015) continue;
      const r = i * SPIRAL_LIMITS.radialStepPc, prev = r - 160;
      const x = prev * Math.cos(spine.rows[k]), y = prev * Math.sin(spine.rows[k]);
      const dx = r * Math.cos(spine.rows[j]) - x, dy = r * Math.sin(spine.rows[j]) - y;
      segments.push({ parent: spine.parent, x, y, dx, dy, length2: dx * dx + dy * dy });
    }
  }
  return { family, barRadiusPc, arms, spines, segments };
}
let memo: SpiralStructure | undefined;
export function spiralStructure(): SpiralStructure { return memo ??= buildSpiralStructure(galaxySeed()); }

/** Shared evaluator. No inverse orbit solves or trigonometry in the hot loop.
 * Dust may be skipped for catalogue rejection. The mean is subtracted after
 * interpolating widths/amplitudes, so conservation holds between rows too. */
export function spiralProfile(radiusPc: number, azimuthRad: number, structure = spiralStructure(), dust = true): { boost: number; lane: number } {
  if (radiusPc < 500 || radiusPc >= SPIRAL_LIMITS.radiusMaxPc) return { boost: 0, lane: 0 };
  const row = radiusPc / SPIRAL_LIMITS.radialStepPc, fraction = row % 1;
  const lo = Math.floor(row) * STRIDE, hi = lo + STRIDE;
  let boost = 0, lane = 0;
  for (const spine of structure.spines) {
    const data = spine.rows;
    const weight = data[lo + 3] + (data[hi + 3] - data[lo + 3]) * fraction;
    if (weight === 0) continue;
    const angle = data[lo] + (data[hi] - data[lo]) * fraction;
    const width = data[lo + 1] + (data[hi + 1] - data[lo + 1]) * fraction;
    boost += weight * (kernel(azimuthRad - angle, width) - KERNEL_MEAN * width);
    if (dust) {
      const laneWidth = data[lo + 2] + (data[hi + 2] - data[lo + 2]) * fraction;
      const laneWeight = data[lo + 4] + (data[hi + 4] - data[lo + 4]) * fraction;
      const offset = data[lo + 5] + (data[hi + 5] - data[lo + 5]) * fraction;
      lane += laneWeight * (kernel(azimuthRad - angle - offset, laneWidth) - KERNEL_MEAN * laneWidth);
    }
  }
  return { boost, lane };
}

export function closestSpiralArm(radiusPc: number, azimuthRad: number): { index: number; distancePc: number } {
  const x = radiusPc * Math.cos(azimuthRad), y = radiusPc * Math.sin(azimuthRad);
  let distance2 = Infinity, index = 0;
  for (const s of spiralStructure().segments) {
    const t = Math.max(0, Math.min(1, ((x - s.x) * s.dx + (y - s.y) * s.dy) / s.length2));
    const d2 = (x - s.x - t * s.dx) ** 2 + (y - s.y - t * s.dy) ** 2;
    if (d2 < distance2) { distance2 = d2; index = s.parent; }
  }
  return { index, distancePc: Math.sqrt(distance2) };
}

/** Conservative contrast ceilings over a Cartesian cell. The enclosing
 * circle bounds its angular cone; bracketing radial rows bound every linear
 * interpolant. Dropping each ridge's negative mean can only raise the bound.
 * Used for sparse cluster proposals, not per-pixel rendering. */
export function spiralCellContrastCeiling(xPc: number, yPc: number, sizePc: number, structure = spiralStructure()): { boost: number; lane: number } {
  const nearest = (lo: number): number => Math.max(lo, Math.min(0, lo + sizePc));
  const minRadius = Math.hypot(nearest(xPc), nearest(yPc));
  if (minRadius >= SPIRAL_LIMITS.radiusMaxPc) return { boost: 0, lane: 0 };
  const maxRadius = Math.hypot(Math.max(Math.abs(xPc), Math.abs(xPc + sizePc)), Math.max(Math.abs(yPc), Math.abs(yPc + sizePc)));
  const lo = Math.max(0, Math.floor(minRadius / SPIRAL_LIMITS.radialStepPc));
  const hi = Math.min(ROWS - 1, Math.ceil(maxRadius / SPIRAL_LIMITS.radialStepPc));
  const cx = xPc + sizePc / 2, cy = yPc + sizePc / 2;
  const halfDiagonal = sizePc / Math.SQRT2, distance = Math.hypot(cx, cy);
  const cone = distance <= halfDiagonal ? Math.PI : Math.asin(halfDiagonal / distance);
  const theta = Math.atan2(cy, cx);
  const peak = (a: number, b: number, width: number): number => {
    if (width === 0) return 0;
    const delta = theta - (a + b) / 2;
    const separation = Math.max(0, Math.abs(delta - TAU * Math.floor((delta + Math.PI) / TAU)) - (b - a) / 2 - cone);
    return separation >= width ? 0 : (1 - (separation / width) ** 2) ** 3;
  };
  let boost = 0, lane = 0;
  for (const spine of structure.spines) {
    let amin = Infinity, amax = -Infinity, dmin = Infinity, dmax = -Infinity;
    let width = 0, laneWidth = 0, weight = 0, laneWeight = 0;
    for (let row = lo; row <= hi; row++) {
      const j = row * STRIDE, d = spine.rows;
      amin = Math.min(amin, d[j]); amax = Math.max(amax, d[j]);
      dmin = Math.min(dmin, d[j] + d[j + 5]); dmax = Math.max(dmax, d[j] + d[j + 5]);
      width = Math.max(width, d[j + 1]); laneWidth = Math.max(laneWidth, d[j + 2]);
      weight = Math.max(weight, d[j + 3]); laneWeight = Math.max(laneWeight, d[j + 4]);
    }
    boost += weight * peak(amin, amax, width);
    lane += laneWeight * peak(dmin, dmax, laneWidth);
  }
  return { boost: Math.min(SPIRAL_LIMITS.starWeight, boost), lane: Math.min(SPIRAL_LIMITS.dustWeight, lane) };
}
