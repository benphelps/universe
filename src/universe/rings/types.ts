export interface RingGap {
  /** Gap center in planet radii. */
  radiusPlanetRadii: number;
  widthPlanetRadii: number;
  /** Resonance with the moon that clears it, e.g. "2:1". */
  resonance: string;
}

export interface RingSystem {
  innerPlanetRadii: number;
  outerPlanetRadii: number;
  /** Peak normal optical depth (Saturn-class ≈ 1, tenuous ≈ 0.05). */
  opticalDepth: number;
  /** Bright water-ice rings vs dark dusty ones. */
  composition: 'icy' | 'dusty';
  hue: [number, number, number];
  albedo: number;
  gaps: RingGap[];
  /** Fine-particle forward scattering strength (backlit glow). */
  forwardScatter: number;
}
