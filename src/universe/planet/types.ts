import type { SurfaceTemperatureField } from './surfaceClimate';
import type { PlanetForcing } from './illumination';
import type { WaterReservoir } from './waterInventory';
export interface PlanetBulk {
  massEarth: number;
  radiusEarth: number;
  densityGcc: number;
  /** Surface (or 1-bar level) gravity, m/s². */
  gravityMs2: number;
  escapeVelocityKms: number;
  /** Rotational flattening (equatorial−polar)/equatorial. */
  oblateness: number;
}

export type GeologicalRegime = 'dead' | 'stagnant-lid' | 'active-tectonics' | 'volcanic' | 'magma' | 'gas';

export interface PlanetInterior {
  ironCoreFraction: number;
  /** Total internal heat flux at the surface, W/m² (Earth ≈ 0.09). */
  heatFluxWm2: number;
  regime: GeologicalRegime;
  /** Dipole strength relative to Earth. */
  magneticFieldRelEarth: number;
}

export interface PlanetRotation {
  /** Sidereal rotation period, hours (equals orbital period when locked). */
  periodHours: number;
  obliquityRad: number;
  locked: boolean;
  /** The body followed by synchronous rotation; legacy fixtures default to star. */
  lockTarget?: 'star' | 'planet';
  /** Interval between stellar noons; null for permanent stellar illumination. */
  solarDayHours?: number | null;
  /** Mercury-style spin-orbit resonance when not fully locked. */
  spinOrbitResonance: '3:2' | null;
}

export type AtmosphereClass =
  | 'none'
  | 'hydrogen-helium'
  | 'nitrogen'
  | 'nitrogen-oxygen'
  | 'co2-hothouse'
  | 'thin-co2'
  | 'nitrogen-methane'
  | 'rock-vapor';

export interface PlanetAtmosphere {
  waterReservoir?: WaterReservoir;
  class: AtmosphereClass;
  surfacePressureBar: number;
  scaleHeightKm: number;
  /** Gray infrared optical depth driving the greenhouse. */
  opticalDepth: number;
  /** Rayleigh/haze scattering color for limb and sky, linear sRGB. */
  scatteringColor: [number, number, number];
  /** Bulk gas inventory, expressed as partial pressures (bar). */
  partialPressuresBar?: Partial<Record<AtmosphericGas, number>>;
  meanMolecularMassAmu?: number;
  specificHeatJkgK?: number;
  rayleighPerBar?: number;
  /** Aerosols retain their formation source when gas composition changes. */
  aerosolClass?: AtmosphereClass;
  /** Included thermostat reservoir, so re-finalization replaces rather than adds it. */
  thermostatCo2Bar?: number;
}

export type AtmosphericGas = 'H2' | 'He' | 'N2' | 'O2' | 'CO2' | 'CH4' | 'SiO' | 'Na' | 'H2O';

export type Hydrosphere = 'none' | 'oceans' | 'ice-sheet' | 'magma';

export interface PlanetClimate {
  /** Static annual energy-balance field; seasonal inertia remains separate. */
  surfaceField?: SurfaceTemperatureField;
  /** Retained bulk water supply for future vapor/condensate partitioning. */
  waterMassFraction?: number;
  /** Equilibrium temperature with the converged Bond albedo, K. */
  equilibriumK: number;
  /** Effective radiating temperature including internal power. Optional
   *  only for older hand-authored fixtures; generation always supplies it. */
  effectiveK?: number;
  /** Background outside lava patches and temperature of those patches. */
  surfaceBackgroundK?: number;
  magmaTemperatureK?: number;
  /** Area-mean surface temperature; effective emission temperature for envelopes. */
  surfaceMeanK: number;
  bondAlbedo: number;
  /** Equivalent polar-cap latitude for the total permanent ice area.
   * Actual ice can be equatorial or longitude-dependent in surfaceField. */
  iceCapLatitudeRad: number;
  hydrosphere: Hydrosphere;
  /** Fraction of the surface covered by water or exposed silicate melt. */
  oceanCoverage: number;
  /** Substellar-to-antistellar contrast for locked worlds, K. */
  dayNightDeltaK: number;
  snowball: boolean;
  /** Photosynthetic oxygen atmosphere present. */
  biosphere: boolean;
  /** Thermostat-regulated CO₂ column, bar (0 on unregulated worlds). */
  co2Bar: number;
}

export interface GiantBanding {
  bandCount: number;
  /** Zone (light) / belt (dark) / storm accent colors, linear sRGB. */
  zoneColor: [number, number, number];
  beltColor: [number, number, number];
  stormColor: [number, number, number];
  turbulence: number;
  /** Great-spot analog: fractional size, 0 = none. */
  majorStormSize: number;
  /** Night-side thermal emission temperature for hot giants, 0 = none. */
  thermalGlowK: number;
}

export type CloudCondensate =
  | 'none'
  | 'water'
  | 'carbon-dioxide'
  | 'sulfuric-acid'
  | 'methane'
  | 'mineral';

/** A solid world's visible condensate layer. Aerosol haze belongs to
 *  the atmosphere column instead, so a Titan-like haze is not mistaken
 *  for an opaque global cloud deck. */
export interface PlanetCloudLayer {
  /** Global area-mean suspended mass; a subset of the retained condensate. */
  condensateColumnKgM2?: number;
  condensate: CloudCondensate;
  /** Fraction of the globe covered when averaged over weather time. */
  coverage: number;
  /** Single-pass visible optical depth through the body of a cloud. */
  opticalDepth: number;
  /** Top of the visible deck above the reference surface. */
  topAltitudeKm: number;
  /** Approximate vertical extent, retained for a future volume renderer. */
  thicknessKm: number;
  /** Dominant horizontal weather-system size. */
  featureScaleKm: number;
  /** Zonal motion of the pattern relative to the ground. */
  driftRadPerDay: number;
  /** Cloud-top relief, from flat stratus (0) to deep convection (1). */
  relief: number;
  /** Positive gathers cloud toward the substellar side; negative toward night. */
  stellarBias: number;
  /** Condensate's diffuse color in linear sRGB. */
  color: [number, number, number];
}

export interface PlanetAppearance {
  /** Two land tones blended by terrain noise, linear sRGB. */
  landColorA: [number, number, number];
  landColorB: [number, number, number];
  oceanColor: [number, number, number];
  iceColor: [number, number, number];
  clouds: PlanetCloudLayer;
  /** Night-side incandescence for magma worlds, 0 = none. */
  lavaGlow: number;
  /** Set for giants and envelope worlds; solid-surface fields unused then. */
  banding: GiantBanding | null;
}

export interface Characterization {
  /** Serializable source/orbit geometry; absent only in legacy physical fixtures. */
  forcing?: PlanetForcing;
  seedHex: string;
  bulk: PlanetBulk;
  interior: PlanetInterior;
  rotation: PlanetRotation;
  atmosphere: PlanetAtmosphere;
  climate: PlanetClimate;
  appearance: PlanetAppearance;
}
