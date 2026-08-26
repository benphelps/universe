import type { OrbitalElements } from '../../core/math/orbit';
import type { Characterization } from '../planet/types';

export type MoonChannel = 'coaccretion' | 'impact' | 'capture';

/** Outcome of planet-raised tidal heating, ordered by heat flux. */
export type TidalState = 'dead' | 'subsurface-ocean' | 'cryovolcanic' | 'volcanic';

export interface Moon {
  /** Parent planet name + roman numeral, e.g. "Talouvelux c II". */
  name: string;
  channel: MoonChannel;
  /** Orbit around the parent planet (planet-centric SI elements). */
  elements: OrbitalElements;
  /** Semi-major axis in parent radii, for placement checks and display. */
  semiMajorAxisPlanetRadii: number;
  /** Retrograde irregular capture orbits. */
  retrograde: boolean;
  /** Planet-raised tidal heat flux, W/m² (Io ≈ 2). */
  tidalHeatFluxWm2: number;
  tidalState: TidalState;
  /** Mean-motion resonance with the next moon inward, e.g. "2:1". */
  resonanceWithInner: string | null;
  physical: Characterization;
}
