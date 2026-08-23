import type { Chromaticity } from '../../core/color/xyz';
import type { LinearRgb } from '../../core/color/srgb';

export type StellarStage =
  | 'brown-dwarf'
  | 'main-sequence'
  | 'subgiant'
  | 'giant'
  | 'horizontal-branch'
  | 'agb'
  | 'supergiant'
  | 'white-dwarf'
  | 'neutron-star'
  | 'black-hole';

/** Physical state at the star's current age. Solar units unless noted. */
export interface StellarPhysical {
  stage: StellarStage;
  /** Current mass, M☉ (post-mass-loss for evolved stars). */
  mass: number;
  /** L☉; 0 for black holes. */
  luminosity: number;
  /** R☉. */
  radius: number;
  /** Effective temperature, K; 0 for black holes. */
  tEff: number;
}

export interface StarActivity {
  rotationPeriodDays: number;
  axialTiltRad: number;
  /** Equator-to-pole relative rotation-rate difference. */
  differentialRotation: number;
  /** Fraction of the photosphere covered by spots. */
  spotCoverage: number;
  /** Center latitude of the spot bands, radians. */
  spotLatitudeRad: number;
  /** Mean flare events per day. */
  flareRatePerDay: number;
  /** Convective granule size relative to solar. */
  granuleRelativeScale: number;
  /** Linear limb-darkening coefficient u in I(μ)=I₀[1−u(1−μ)]. */
  limbDarkeningU: number;
}

export type VariabilityType = 'cepheid' | 'rr-lyrae' | 'mira';

export interface Variability {
  type: VariabilityType;
  periodDays: number;
  /** Fractional luminosity half-amplitude. */
  amplitude: number;
}

/** Orbit of a companion star around the pair barycenter's primary. */
export interface CompanionOrbit {
  periodDays: number;
  semiMajorAxisAu: number;
  eccentricity: number;
}

export interface Companion {
  orbit: CompanionOrbit;
  star: Star;
}

export interface Star extends StellarPhysical {
  seedHex: string;
  designation: string;
  /** Zero-age mass, M☉. */
  massInitial: number;
  ageGyr: number;
  /** Metallicity [Fe/H], dex. */
  feH: number;
  /** e.g. "G2V", "M5III", "DA4". */
  spectralType: string;
  chromaticity: Chromaticity;
  /** Peak-normalized linear sRGB hue. */
  linearRgb: LinearRgb;
  activity: StarActivity;
  variability: Variability | null;
  companions: Companion[];
}
