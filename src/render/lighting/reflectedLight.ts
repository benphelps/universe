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
 * Earth comes out ~2×10⁻⁶ — the real number. It stays a physical ratio
 * when mixed with the host light; adaptation belongs to the completed
 * image, not to this source switching on at sunset.
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

/** A reflected body's contribution on the host light's existing display
 * scale. Keeping the physical flux ratio linear prevents a colored body from
 * changing the ground palette when an arbitrary day/night gate is crossed. */
export function reflectedLightColor(
  hostLight: readonly [number, number, number],
  tint: readonly [number, number, number],
  fluxRatio: number,
): [number, number, number] {
  const ratio = Math.max(0, fluxRatio);
  return [
    hostLight[0] * tint[0] * ratio,
    hostLight[1] * tint[1] * ratio,
    hostLight[2] * tint[2] * ratio,
  ];
}

/** What color a body's reflected light carries: its clouds where they
 *  cover, its ground where they don't, normalized to chroma only (the
 *  Bond albedo already owns the brightness). */
export function shineTint(appearance: PlanetAppearance): [number, number, number] {
  const cloud = Math.min(1, appearance.clouds.coverage * 0.8);
  const r = appearance.landColorA[0] * (1 - cloud) + appearance.clouds.color[0] * cloud;
  const g = appearance.landColorA[1] * (1 - cloud) + appearance.clouds.color[1] * cloud;
  const b = appearance.landColorA[2] * (1 - cloud) + appearance.clouds.color[2] * cloud;
  const peak = Math.max(r, g, b, 1e-6);
  return [r / peak, g / peak, b / peak];
}
