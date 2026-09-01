import { gamutMap, xyzToLinearSrgb, type LinearRgb } from '../../core/color/srgb';
import { spectralLinesToXyz } from '../../core/color/xyz';

/**
 * What an H II region is actually made of: a few recombination and
 * forbidden lines, not a continuum. Colour comes from integrating them
 * against the eye's own response, so it is the mixture that decides the
 * hue rather than a palette — which is why a real-colour photograph of
 * an H II region is pink rather than the teal of a narrowband map.
 *
 * Intensities are relative to Hβ, Case B at 10⁴ K. The oxygen pair
 * scales with how hard the ionizing spectrum is: a hot O star doubly
 * ionizes oxygen well beyond where a B star can, which is the one
 * ratio that visibly moves a nebula's colour.
 */
const HYDROGEN: ReadonlyArray<readonly [number, number]> = [
  [656.3, 2.86], // Hα — Case B ratio to Hβ
  [486.1, 1.0], // Hβ
  [434.0, 0.47], // Hγ
];

/** The low-ionization skin: strongest where the front is thickest. */
const LOW_IONIZATION: ReadonlyArray<readonly [number, number]> = [
  [658.4, 0.6], // [N II]
  [654.8, 0.2], // [N II]
  [671.7, 0.2], // [S II]
  [673.1, 0.15], // [S II]
];

/** Doubly ionized oxygen, the teal end. */
const OXYGEN: ReadonlyArray<readonly [number, number]> = [
  [500.7, 3.0], // [O III]
  [495.9, 1.0], // [O III] — fixed 1:3 by atomic physics
];

/**
 * The colour of nebular emission at a given ionization hardness, 0 for
 * a barely-ionized skin to 1 under the hottest stars.
 */
export function nebulaEmissionColor(hardness: number): LinearRgb {
  const h = Math.min(1, Math.max(0, hardness));
  const lines = [
    ...HYDROGEN,
    ...LOW_IONIZATION.map(([nm, i]) => [nm, i * (1 - 0.7 * h)] as const),
    ...OXYGEN.map(([nm, i]) => [nm, i * h] as const),
  ];
  return unitLuminance(gamutMap(xyzToLinearSrgb(spectralLinesToXyz(lines))));
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
