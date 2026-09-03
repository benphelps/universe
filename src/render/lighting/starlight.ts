import { AU } from '../../core/physics/constants';
import type { Star } from '../../universe/star/types';
import { luminosityMultiplierAt } from '../../universe/star/variability';

const AU_KM = AU / 1000;

/**
 * The display's eye: every lift the system view applies to a physical
 * flux ratio is this one power, so moonlight, starlight, and a
 * planet's own sun all sit on the same adapted scale.
 */
export const ADAPTATION_EXPONENT = 0.2;

/** A moonless sky's own light — starlight and airglow — as a fraction
 *  of full sunlight, about a millilux against a hundred kilolux. */
export const SKYGLOW_FLUX_RATIO = 1.5e-8;

/**
 * Atmospheric background radiances bounding each class of night-sky
 * feature. All are in the units returned by the sky scattering model:
 * radiance relative to a white Lambertian surface under the local star.
 *
 * A point source is detectable against a much brighter background than
 * an extended source of the same total flux. Keeping those contrast
 * thresholds separate gives twilight its natural order: bright stars,
 * then the field, then the Milky Way and diffuse nebulae.
 */
export const POINT_STAR_FULL_RADIANCE = 1e-4;
export const POINT_STAR_HIDDEN_RADIANCE = 3e-2;
export const EXTENDED_SKY_FULL_RADIANCE = 2e-7;
export const EXTENDED_SKY_HIDDEN_RADIANCE = 3e-3;

function contrastVisibility(
  daylightRadiance: number,
  fullRadiance: number,
  hiddenRadiance: number,
): number {
  if (!(daylightRadiance > fullRadiance)) return 1;
  if (daylightRadiance >= hiddenRadiance) return 0;
  // Perception spans orders of magnitude. Interpolate in log-radiance,
  // with zero slope at both ends so neither end of the fade can pop.
  const t =
    Math.log(daylightRadiance / fullRadiance) /
    Math.log(hiddenRadiance / fullRadiance);
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

/** Visibility of unresolved stars against the atmospheric background. */
export function pointStarVisibility(daylightRadiance: number): number {
  return contrastVisibility(
    daylightRadiance,
    POINT_STAR_FULL_RADIANCE,
    POINT_STAR_HIDDEN_RADIANCE,
  );
}

/** Visibility of low-contrast galactic glow and resolved nebulae. */
export function extendedSkyVisibility(daylightRadiance: number): number {
  return contrastVisibility(
    daylightRadiance,
    EXTENDED_SKY_FULL_RADIANCE,
    EXTENDED_SKY_HIDDEN_RADIANCE,
  );
}

/** What a flux ratio displays as once the eye has settled on it. */
export function adapted(fluxRatio: number): number {
  return Math.max(fluxRatio, 0) ** ADAPTATION_EXPONENT;
}

/** Stellar flux at a distance relative to Earth's sunlight: L/d². */
export function instellation(luminosity: number, distanceKm: number): number {
  return luminosity / Math.max(distanceKm / AU_KM, 1e-9) ** 2;
}

/**
 * The light a star casts on a body at this distance, as displayed:
 * the star's hue at its adapted instellation, with pulsation and
 * flares at full contrast on top — adaptation settles on the mean,
 * a flicker shows whole. Sunlight at one AU displays at one.
 */
export function starlight(
  star: Star,
  distanceKm: number,
  simTimeDays: number,
): [number, number, number] {
  const level =
    adapted(instellation(star.luminosity, distanceKm)) *
    luminosityMultiplierAt(star, simTimeDays);
  return [star.linearRgb[0] * level, star.linearRgb[1] * level, star.linearRgb[2] * level];
}
