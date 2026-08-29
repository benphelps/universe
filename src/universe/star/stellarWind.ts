import { G, SOLAR_LUMINOSITY, SOLAR_MASS, SOLAR_RADIUS, YEAR } from '../../core/physics/constants';
import type { StellarPhysical } from './types';

/**
 * What a star throws away, and how fast it leaves.
 *
 * Every star loses mass, and how it does so splits cleanly on where it
 * sits. Cool giants and supergiants drive slow, dense winds off loosely
 * bound envelopes — dust and pulsation push them out at a few tens of
 * kilometres a second, and a red supergiant can shed a solar mass in a
 * hundred thousand years. Hot luminous stars drive fast, thin ones by
 * line absorption in the ultraviolet, thousands of kilometres a second
 * but orders of magnitude less material. The Sun does neither in any
 * quantity worth counting.
 *
 * Nothing here matters to a star on its own. It matters when something
 * is standing nearby to catch it.
 */

/**
 * Mass-loss rate, kg/s. Reimers' relation for the cool side, where the
 * wind scales as LR/M — the luminosity does the work, the radius gives
 * it the loose grip, and gravity resists — and a radiation-driven
 * scaling on the hot side, where it goes as a steep power of the
 * luminosity alone. A star that qualifies for neither loses the trickle
 * the Sun does, which rounds to nothing against either.
 */
export function massLossRate(star: StellarPhysical): number {
  if (star.luminosity <= 0 || star.mass <= 0) return 0;
  const solarPerYear = SOLAR_MASS / YEAR;

  // Reimers, with the standard efficiency. It is an empirical fit to
  // evolved cool stars and belongs only to them: applied to the Sun it
  // overstates the solar wind tenfold, because a main-sequence star's
  // envelope is bound in a way a giant's is not.
  const evolved =
    star.stage === 'subgiant' ||
    star.stage === 'giant' ||
    star.stage === 'horizontal-branch' ||
    star.stage === 'agb' ||
    star.stage === 'supergiant';
  const reimers =
    evolved && star.tEff < 8000
      ? 4e-13 * 0.5 * ((star.luminosity * star.radius) / star.mass)
      : 0;

  // Line-driven, for the hot and luminous: steep in L, and no dust to
  // help, so it needs a genuinely bright star before it amounts to
  // anything. Anchored on an O star's known megayear-scale rate.
  const lineDriven =
    star.tEff > 10000 && star.luminosity > 1e4
      ? 1e-7 * (star.luminosity / 1e5) ** 1.6
      : 0;

  // Everything else: the solar wind, which is 2e-14 M☉/yr and is here
  // only so the answer is never exactly zero.
  return Math.max(reimers, lineDriven, 2e-14) * solarPerYear;
}

/**
 * Terminal wind speed, m/s. Both winds are launched against the star's
 * own escape velocity and end up near a multiple of it — a fast, hot
 * wind at about three times, a cool dusty one at well under, since dust
 * only forms far out where the grip has already loosened.
 */
export function windSpeed(star: StellarPhysical): number {
  if (star.mass <= 0 || star.radius <= 0) return 1;
  const escape = Math.sqrt(
    (2 * G * star.mass * SOLAR_MASS) / (star.radius * SOLAR_RADIUS),
  );
  return star.tEff > 10000 ? 2.6 * escape : 0.4 * escape;
}

/**
 * Wind speed at distance r from the star's centre, m/s. A wind does not
 * leave at its terminal speed — it is pushed up to it over several
 * stellar radii, on the beta law that fits observed line profiles. Far
 * away this is indistinguishable from the terminal value and can be
 * ignored; a companion sitting three stellar radii out is meeting gas
 * at two thirds of it, and since capture goes as the fourth power of
 * the speed that is a factor of five in what it catches. It is why the
 * close wind-fed binaries are the bright ones.
 */
export function windSpeedAt(star: StellarPhysical, radiusM: number): number {
  const surface = star.radius * SOLAR_RADIUS;
  if (radiusM <= surface) return 0.01 * windSpeed(star);
  return windSpeed(star) * Math.max(1 - surface / radiusM, 0.01) ** 0.8;
}

/**
 * Radius of the donor's Roche lobe as a fraction of the separation,
 * from Eggleton's fit to the equipotential surface. q is the donor's
 * mass over its companion's. Fill this and the star stops being a star
 * with a wind and starts being a stream.
 */
export function rocheLobeFraction(q: number): number {
  const c = Math.cbrt(Math.max(q, 1e-9));
  return (0.49 * c * c) / (0.6 * c * c + Math.log(1 + c));
}

/**
 * Kelvin–Helmholtz time, seconds: how long a star could shine on its
 * own gravitational binding energy. It is also how fast an envelope
 * knocked out of equilibrium puts itself back, which is what sets the
 * transfer rate once a lobe is overflowing and the mass ratio is such
 * that giving mass away only makes the overflow worse.
 */
export function thermalTimescale(star: StellarPhysical): number {
  const m = star.mass * SOLAR_MASS;
  const r = star.radius * SOLAR_RADIUS;
  const l = Math.max(star.luminosity, 1e-6) * SOLAR_LUMINOSITY;
  return (G * m * m) / (r * l);
}
