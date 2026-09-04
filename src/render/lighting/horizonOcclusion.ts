import { ShaderMaterial, Vector3 } from 'three';

/**
 * Analytic solid-body horizon for distant sky objects behind streamed terrain.
 * The rendered terrain still supplies the exact local silhouette; this sphere
 * only closes gaps beyond the streamed mesh.
 */
export const HORIZON_OCCLUSION_GLSL = /* glsl */ `
uniform vec3 uHorizonBodyCenter;
uniform float uHorizonBodyRadius;

bool horizonOccludes(vec3 worldPos) {
  if (uHorizonBodyRadius <= 0.0) return false;
  vec3 fromCenter = cameraPosition - uHorizonBodyCenter;
  float radius2 = uHorizonBodyRadius * uHorizonBodyRadius;
  // Never turn a camera that has slipped under the approximation into a
  // black screen. The streamed terrain remains authoritative there.
  if (dot(fromCenter, fromCenter) <= radius2) return false;
  vec3 ray = worldPos - cameraPosition;
  float distanceToPoint = length(ray);
  vec3 dir = ray / max(distanceToPoint, 1e-9);
  float closestAlong = -dot(fromCenter, dir);
  if (closestAlong <= 0.0 || closestAlong >= distanceToPoint) return false;
  vec3 closest = fromCenter + dir * closestAlong;
  return dot(closest, closest) < radius2;
}
`;

export function horizonOcclusionUniforms(): Record<string, { value: unknown }> {
  return {
    uHorizonBodyCenter: { value: new Vector3() },
    uHorizonBodyRadius: { value: 0 },
  };
}

/** Seat or clear the analytic horizon carried by a sky-object material. */
export function applyHorizonOcclusion(
  material: ShaderMaterial,
  center: Vector3 | null,
  radius: number,
): void {
  const uniforms = material.uniforms;
  if (!uniforms.uHorizonBodyRadius) return;
  const enabledRadius = center && radius > 0 ? radius : 0;
  uniforms.uHorizonBodyRadius.value = enabledRadius;
  if (center) (uniforms.uHorizonBodyCenter.value as Vector3).copy(center);
}

/** CPU mirror of the shader's segment/sphere test for geometry regressions. */
export function horizonOccludesSegment(
  camera: Vector3,
  target: Vector3,
  center: Vector3,
  radius: number,
): boolean {
  if (!(radius > 0)) return false;
  const fromCenter = camera.clone().sub(center);
  const radius2 = radius * radius;
  if (fromCenter.lengthSq() <= radius2) return false;
  const ray = target.clone().sub(camera);
  const distanceToPoint = ray.length();
  if (!(distanceToPoint > 0)) return false;
  const dir = ray.divideScalar(distanceToPoint);
  const closestAlong = -fromCenter.dot(dir);
  if (closestAlong <= 0 || closestAlong >= distanceToPoint) return false;
  return fromCenter.addScaledVector(dir, closestAlong).lengthSq() < radius2;
}
