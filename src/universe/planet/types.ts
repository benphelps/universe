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

export type GeologicalRegime = 'dead' | 'stagnant-lid' | 'active-tectonics' | 'magma' | 'gas';

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
  class: AtmosphereClass;
  surfacePressureBar: number;
  scaleHeightKm: number;
  /** Gray infrared optical depth driving the greenhouse. */
  opticalDepth: number;
  /** Rayleigh/haze scattering color for limb and sky, linear sRGB. */
  scatteringColor: [number, number, number];
}

export type Hydrosphere = 'none' | 'oceans' | 'ice-sheet' | 'magma';

export interface PlanetClimate {
  /** Equilibrium temperature with the converged Bond albedo, K. */
  equilibriumK: number;
  /** Mean surface (or cloud-top, for envelopes) temperature, K. */
  surfaceMeanK: number;
  bondAlbedo: number;
  /** Latitude where permanent ice begins (π/2 = no caps, 0 = snowball). */
  iceCapLatitudeRad: number;
  hydrosphere: Hydrosphere;
  /** Fraction of surface under liquid, when hydrosphere is oceans. */
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

export interface PlanetAppearance {
  /** Two land tones blended by terrain noise, linear sRGB. */
  landColorA: [number, number, number];
  landColorB: [number, number, number];
  oceanColor: [number, number, number];
  iceColor: [number, number, number];
  cloudCoverage: number;
  cloudColor: [number, number, number];
  /** Night-side incandescence for magma worlds, 0 = none. */
  lavaGlow: number;
  /** Set for giants and envelope worlds; solid-surface fields unused then. */
  banding: GiantBanding | null;
}

export interface Characterization {
  seedHex: string;
  bulk: PlanetBulk;
  interior: PlanetInterior;
  rotation: PlanetRotation;
  atmosphere: PlanetAtmosphere;
  climate: PlanetClimate;
  appearance: PlanetAppearance;
}
