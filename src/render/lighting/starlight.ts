import { surfaceBandRgb, surfaceLightExposure } from './surfaceRadiometry';
import { AU } from '../../core/physics/constants';
import type { Star } from '../../universe/star/types';
import { luminosityMultiplierAt } from '../../universe/star/variability';

const AU_KM = AU / 1000;

/**
 * Legacy sky/point contrast response. Surface sources use a shared
 * linear exposure (surfaceRadiometry), not an independent power law.
 */
export const ADAPTATION_EXPONENT = 0.2;

/** A moonless sky's own light — starlight and airglow — as a fraction
 * of full sunlight, about a millilux against a hundred kilolux. Used as
 * a measured visibility floor for the sky, not injected into surfaces. */
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

/** Incident visible light under one shared, linear scene exposure.
 * A caller without scene context settles on this star's mean illumination. */
export function starlight(
  star: Star,
  distanceKm: number,
  simTimeDays: number,
  exposure = surfaceLightExposure(instellation(star.luminosity, distanceKm)),
): [number, number, number] {
  return surfaceBandRgb(instellation(star.luminosity, distanceKm) * luminosityMultiplierAt(star, simTimeDays), star.tEff)
    .map(c => c * exposure) as [number, number, number];
}
