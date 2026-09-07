import { gamutMap, type LinearRgb } from './srgb';
import { stellarOpticalResponse } from './stellarOpticalResponse';

/** Source spectrum response, independent of exposure, visibility and PSF.
 * Samples contain three unmapped colour ratios and log band fraction,
 * on a padded log-temperature grid. Log power resolves the steep Wien
 * tail without a huge table; the colour ratios remain smooth.
 * Additional filters can supply their own offline response tables. */
export interface StellarResponse {
  id: string;
  /** Conservative maximum of the interpolated band/bolometric power. */
  maxFraction: number;
  wavelengthNm: readonly [number, number];
  minLogTemperature: number;
  logStep: number;
  count: number;
  samples: readonly number[];
}

/** Band power with display-mapped hue, in solar luminosities. This is
 * an optical blackbody approximation, not a stellar-atmosphere spectrum.
 * Zero/invalid sources contribute no light; spectra are never peak-normalized.
 * Temperatures outside a response grid clamp to its endpoint spectra. */
export function stellarBandRgb(luminosity: number, temperature: number, response: StellarResponse = stellarOpticalResponse): LinearRgb {
  if (!(luminosity > 0) || !(temperature > 0) || !Number.isFinite(luminosity + temperature)) return [0, 0, 0];
  const coord = Math.max(0, Math.min(response.count - 1,
    (Math.log(temperature) - response.minLogTemperature) / response.logStep));
  const index = Math.min(response.count - 2, Math.floor(coord));
  const t = coord - index, a = response.samples;
  const channel = (c: number) => {
    const p = a[index * 4 + c], q = a[(index + 1) * 4 + c];
    const r = a[(index + 2) * 4 + c], s = a[(index + 3) * 4 + c];
    return q + .5 * t * (r - p + t * (2 * p - 5 * q + 4 * r - s + t * (3 * (q - r) + s - p)));
  };
  const rgb = gamutMap([channel(0), channel(1), channel(2)]);
  const y = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  const scale = y > 0 ? Math.exp(channel(3)) * luminosity / y : 0;
  return [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale];
}

/** Splitting power and unit-Y hue retains a compact existing point format.
 * A multi-star source must sum powers before making this split. */
export function splitStellarLight(rgb: readonly number[]): { luminosity: number; color: LinearRgb } {
  const luminosity = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  return { luminosity, color: luminosity > 0
    ? [rgb[0] / luminosity, rgb[1] / luminosity, rgb[2] / luminosity] : [0, 0, 0] };
}
