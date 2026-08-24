import type { Kelvin, Kilograms, Meters, Seconds, Watts } from './units';

/** Physical constants (SI). */
export const G = 6.6743e-11; // m³ kg⁻¹ s⁻²
export const SIGMA_SB = 5.670374419e-8; // W m⁻² K⁻⁴
export const K_B = 1.380649e-23; // J K⁻¹
export const H_PLANCK = 6.62607015e-34; // J s
export const C_LIGHT = 2.99792458e8; // m s⁻¹
export const WIEN_B = 2.897771955e-3; // m K

/** Astronomical scale anchors (SI). */
export const AU = 1.495978707e11 as Meters;
export const PARSEC = 3.0856775814913673e16 as Meters;
export const SOLAR_MASS = 1.98892e30 as Kilograms;
export const SOLAR_RADIUS = 6.957e8 as Meters;
export const SOLAR_LUMINOSITY = 3.828e26 as Watts;
export const SOLAR_TEFF = 5772 as Kelvin;
export const EARTH_MASS = 5.9722e24 as Kilograms;
export const EARTH_RADIUS = 6.371e6 as Meters;
export const JUPITER_MASS = 1.89813e27 as Kilograms;
export const JUPITER_RADIUS = 6.9911e7 as Meters;

/** Time (SI seconds). */
export const DAY = 86400 as Seconds;
export const YEAR = 3.15576e7 as Seconds; // Julian year
export const GYR = (1e9 * YEAR) as Seconds;
