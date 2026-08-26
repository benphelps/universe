import type { Vector3 } from 'three';
import type { PlanetAppearance } from '../../universe/planet/types';

/** A sunlit body whose reflected light can reach the focus surface. */
export interface ShineBody {
  /** World-frame position relative to the focus origin, km. */
  positionKm: Vector3;
  radiusKm: number;
  bondAlbedo: number;
  /** Chroma of the reflected light, luminance-normalized linear RGB. */
  tint: [number, number, number];
}

/**
 * Reflected flux at the focus origin relative to direct sunlight
 * there: albedo × (R/d)² × Lambert-sphere phase. A full Moon over
 * Earth comes out ~2×10⁻⁶ — the real number, far below what a linear
 * display can show; the caller owns any adaptation lift.
 */
export function reflectedFluxRatio(body: ShineBody, sunDirAtBody: Vector3): number {
  const dKm = body.positionKm.length();
  if (dKm <= body.radiusKm * 1.5) return 0;
  const toBodyX = body.positionKm.x / dKm;
  const toBodyY = body.positionKm.y / dKm;
  const toBodyZ = body.positionKm.z / dKm;
  // Phase angle at the body between the sun and the observer.
  const cosPhase = -(
    toBodyX * sunDirAtBody.x +
    toBodyY * sunDirAtBody.y +
    toBodyZ * sunDirAtBody.z
  );
  const phase = Math.acos(Math.min(1, Math.max(-1, cosPhase)));
  const lambert = ((Math.PI - phase) * Math.cos(phase) + Math.sin(phase)) / Math.PI;
  return body.bondAlbedo * (body.radiusKm / dKm) ** 2 * Math.max(0, lambert);
}

/** What color a body's reflected light carries: its clouds where they
 *  cover, its ground where they don't, normalized to chroma only (the
 *  Bond albedo already owns the brightness). */
export function shineTint(appearance: PlanetAppearance): [number, number, number] {
  const cloud = Math.min(1, appearance.cloudCoverage * 0.8);
  const r = appearance.landColorA[0] * (1 - cloud) + appearance.cloudColor[0] * cloud;
  const g = appearance.landColorA[1] * (1 - cloud) + appearance.cloudColor[1] * cloud;
  const b = appearance.landColorA[2] * (1 - cloud) + appearance.cloudColor[2] * cloud;
  const peak = Math.max(r, g, b, 1e-6);
  return [r / peak, g / peak, b / peak];
}
