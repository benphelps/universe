import type { OrbitalElements } from '../../core/math/orbit';
import type { Moon } from '../moon/types';
import type { Characterization } from '../planet/types';
import type { RingSystem } from '../rings/types';
import type { Comet } from '../smallbody/types';
import type { Star } from '../star/types';

/** Bulk class assigned at system level; the planet level characterizes it fully. */
export type PlanetClass = 'rocky' | 'super-earth' | 'mini-neptune' | 'ice-giant' | 'gas-giant';

export interface Planet {
  /** e.g. "SIM-00000001 b", letters outward from the star. */
  name: string;
  class: PlanetClass;
  /** SI elements referenced to the system invariable plane; epoch 0. */
  elements: OrbitalElements;
  inHabitableZone: boolean;
  tidallyLocked: boolean;
  /** Mean-motion resonance with the previous planet, e.g. "3:2". */
  resonanceWithInner: string | null;
  /** Full physical characterization (bulk, interior, atmosphere, climate, appearance). */
  physical: Characterization;
  moons: Moon[];
  rings: RingSystem | null;
}

export interface BeltGap {
  semiMajorAxisAu: number;
  widthAu: number;
  /** Resonance with the perturbing giant that carves it, e.g. "3:1". */
  resonance: string;
}

export interface Belt {
  kind: 'main' | 'outer';
  innerAu: number;
  outerAu: number;
  gaps: BeltGap[];
  resonantPopulations: Array<{ semiMajorAxisAu: number; resonance: string }>;
  inclinationDispersionRad: number;
}

/** Distant small-body reservoirs, kept as parameters until bodies are instantiated lazily. */
export interface Reservoirs {
  scatteredDiscInnerAu: number;
  oortInnerAu: number;
  oortOuterAu: number;
}

export interface SystemZones {
  /** Kopparapu runaway-greenhouse / maximum-greenhouse bounds. */
  habitableInnerAu: number;
  habitableOuterAu: number;
  frostLineAu: number;
  /** Planets inside this are tidally locked at the system's age. */
  tidalLockAu: number;
}

/** A stellar companion with a full orbit for rendering and stability limits. */
export interface StellarCompanion {
  star: Star;
  elements: OrbitalElements;
}

export type SystemConfiguration = 'single' | 's-type' | 'p-type';

export interface StarSystem {
  seedHex: string;
  star: Star;
  companions: StellarCompanion[];
  /** s-type: planets orbit the primary; p-type: planets orbit a close binary pair. */
  configuration: SystemConfiguration;
  /** Mass planets orbit: the primary, or the binary pair for p-type (M☉). */
  centralMassSolar: number;
  planets: Planet[];
  belts: Belt[];
  comets: Comet[];
  reservoirs: Reservoirs;
  zones: SystemZones;
}
