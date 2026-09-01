import { gamutMap, xyzToLinearSrgb, type LinearRgb } from '../../core/color/srgb';
import { spectralLinesToXyz } from '../../core/color/xyz';

/**
 * What an H II region is actually made of: a few recombination and
 * forbidden lines, not a continuum. Colour comes from integrating them
 * against the eye's own response, so it is the mixture that decides the
 * hue rather than a palette — which is why a real-colour photograph of
 * an H II region is pink rather than the teal of a narrowband map.
 *
 * The mixture runs over the three axes that actually move it — the
 * ionizing star's temperature, the local ionization parameter, and the
 * gas metallicity — the grid the plan called for. Intensities are
 * relative to Hβ, Case B at 10⁴ K, anchored on measured regions:
 * Orion's core lands at [O III] 5007/Hβ ≈ 3, 30 Doradus near 6, a
 * B-star region under a half, and [N II]/[S II] carry the low-U skin
 * at their observed shares of Hα. Because metallicity enters, nebular
 * colour varies with galactocentric radius on its own.
 */

/** The Balmer backbone, Case B at 10⁴ K — metallicity-blind. */
const HYDROGEN: ReadonlyArray<readonly [number, number]> = [
  [656.3, 2.86], // Hα
  [486.1, 1.0], // Hβ
  [434.0, 0.47], // Hγ
  [410.2, 0.26], // Hδ
];

/** Smooth 0→1 over [lo, hi]. */
function ramp(value: number, lo: number, hi: number): number {
  const t = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** O²⁺ needs 35.1 eV photons: nothing below a hot B star, saturating
 *  through the O types. */
function oxygenHardness(tEff: number): number {
  return ramp(tEff, 32000, 42000);
}

/**
 * The electron-temperature inversion: metal-poor gas cools badly, runs
 * hot, and collisionally excites its scarce oxygen harder per atom —
 * so [O III]/Hβ peaks at LMC-like metallicity and falls toward both
 * the metal-rich and metal-free ends. Unity at solar by construction.
 */
function oxygenExcitation(z: number): number {
  return z * (1.15 / (0.15 + z)) ** 1.7;
}

/**
 * Every line of the mixture at a point on the grid: u01 is the bake's
 * normalized log U (its B channel), tEff the ionizing star's, feH the
 * gas metallicity. Strengths relative to Hβ.
 */
export function nebulaLines(
  u01: number,
  tEff: number,
  feH: number,
): Array<readonly [number, number]> {
  const u = Math.min(1, Math.max(0, u01));
  const z = 10 ** feH;
  const lines: Array<readonly [number, number]> = [...HYDROGEN];
  // [O III] — the teal end: hard photons, high U, and the excitation
  // inversion; the 5007/4959 pair fixed 3:1 by atomic physics.
  const o3 = 6.5 * oxygenExcitation(z) * oxygenHardness(tEff) * u;
  if (o3 > 0) {
    lines.push([500.7, o3 * 0.75], [495.9, o3 * 0.25]);
  }
  // The low-ionization skin, strongest where U runs low: secondary
  // nitrogen steepens with metallicity, sulfur follows it linearly.
  const n2 = 1.6 * z ** 1.6 * (1 - 0.75 * u);
  lines.push([658.4, n2 * 0.75], [654.8, n2 * 0.25]);
  const s2 = 0.85 * z * (1 - 0.8 * u);
  lines.push([671.7, s2 * 0.57], [673.1, s2 * 0.43]);
  // He I, the one yellow line worth carrying under hot stars.
  const he = 0.13 * ramp(tEff, 30000, 37000);
  if (he > 0) lines.push([587.6, he]);
  return lines;
}

/** A representative ionization parameter for whole-object questions —
 *  a sprite's hue, a group's total line budget — where no per-cell U
 *  exists: bright cores run high. */
export const NEBULA_MEAN_U = 0.6;

/** Every optical line the mixture carries, relative to Hβ. What the
 *  nebula radiates is this times its Hβ luminosity. */
export function nebulaLineSum(u01: number, tEff = 40000, feH = 0): number {
  return nebulaLines(u01, tEff, feH).reduce((sum, [, intensity]) => sum + intensity, 0);
}

/** The colour of nebular emission at a point on the grid, 0 for a
 *  barely-ionized skin to 1 under the hottest stars. */
export function nebulaEmissionColor(u01: number, tEff = 40000, feH = 0): LinearRgb {
  return unitLuminance(
    gamutMap(xyzToLinearSrgb(spectralLinesToXyz(nebulaLines(u01, tEff, feH)))),
  );
}

/**
 * The same point on the grid through the mapped-narrowband instrument:
 * the Hubble palette, [S II] to red, Hα to green, [O III] to blue —
 * false colour by construction and labelled as such, but the channels
 * are the real line strengths, so ionization structure reads directly:
 * hard high-U cores go blue-white, low-U skins go rust.
 */
export function nebulaNarrowbandColor(u01: number, tEff = 40000, feH = 0): LinearRgb {
  let s2 = 0;
  let ha = 0;
  let o3 = 0;
  for (const [nm, strength] of nebulaLines(u01, tEff, feH)) {
    if (nm === 671.7 || nm === 673.1) s2 += strength;
    else if (nm === 656.3) ha += strength;
    else if (nm === 500.7 || nm === 495.9) o3 += strength;
  }
  return unitLuminance([s2, ha, o3]);
}

/**
 * Scale a hue to unit luminance. The volume's own emission measure
 * carries how bright the gas is, so the colour must not smuggle
 * brightness in with it — normalizing to the peak channel would make a
 * teal nebula outshine a pink one for no physical reason.
 */
function unitLuminance(rgb: LinearRgb): LinearRgb {
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (y <= 0) return [0, 0, 0];
  return [rgb[0] / y, rgb[1] / y, rgb[2] / y];
}
