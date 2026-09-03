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
