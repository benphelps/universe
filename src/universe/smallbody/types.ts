import type { OrbitalElements } from '../../core/math/orbit';

export type AsteroidTaxonomy = 'S' | 'C' | 'M' | 'D';

export interface AsteroidShape {
  /** Triaxial ellipsoid ratios b/a and c/a (1 = sphere). */
  elongation: number;
  flattening: number;
  /** Bilobed contact-binary silhouette. */
  contactBinary: boolean;
  /** Lump/crater noise seed offset for the renderer. */
  noiseSeedHex: string;
}

export interface Asteroid {
  elements: OrbitalElements;
  diameterKm: number;
  taxonomy: AsteroidTaxonomy;
  albedo: number;
  spinPeriodHours: number;
  /** Non-principal-axis tumbling (slow rotators). */
  tumbling: boolean;
  /** Gravitationally bound rubble vs coherent monolith. */
  rubblePile: boolean;
  shape: AsteroidShape;
}

export interface Comet {
  name: string;
  /** Heliocentric near-parabolic elements. */
  elements: OrbitalElements;
  nucleusKm: number;
  /** Sublimation switches on inside this distance. */
  activityOnsetAu: number;
  /** Dust-to-gas balance: dusty comets grow broad curved tails. */
  dustiness: number;
}
