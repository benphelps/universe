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
  /** Stable address in a funded belt's largest-first inventory. */
  population?: { seedHex: string; rank: number };
  /** Inventory's effective density, including unresolved porosity. */
  bulkDensityKgM3?: number;
  elements: OrbitalElements;
  diameterKm: number;
  taxonomy: AsteroidTaxonomy;
  /** Optical geometric albedo, also used by the reflected-light glint. */
  albedo: number;
  spinPeriodHours: number;
  /** Non-principal-axis tumbling (slow rotators). */
  tumbling: boolean;
  /** Loose rubble aggregate. False does not assert a differentiated interior. */
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
