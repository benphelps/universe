import { ShaderMaterial, Vector3, Vector4 } from 'three';

/**
 * Analytic eclipse shadows: spherical occluders (moons shadowing their
 * planet, planets eclipsing their moons) tested along the star ray per
 * fragment, with penumbra width set by the star's angular size; plus the
 * shadow band a ring system casts on its planet.
 */
export const SHADOW_GLSL = /* glsl */ `
uniform int uOccluderCount;
uniform vec4 uOccluders[4];
uniform float uStarAngularRadius;
uniform vec4 uRingShadow;
uniform vec3 uRingNormal;

float shadowFactor(vec3 worldPos, vec3 lightDir) {
  float light = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uOccluderCount) break;
    vec3 toOccluder = uOccluders[i].xyz - worldPos;
    float along = dot(toOccluder, lightDir);
    if (along <= 0.0) continue;
    float closest = length(toOccluder - along * lightDir);
    float penumbra = uOccluders[i].w + along * uStarAngularRadius;
    float umbra = max(uOccluders[i].w - along * uStarAngularRadius, 0.0);
    light *= smoothstep(umbra, penumbra, closest);
  }
  if (uRingShadow.w > 0.5) {
    float denom = dot(uRingNormal, lightDir);
    if (abs(denom) > 1e-4) {
      float t = dot(uRingNormal, -worldPos) / denom;
      if (t > 0.0) {
        vec3 hit = worldPos + lightDir * t;
        float r = length(hit);
        float inRing = smoothstep(uRingShadow.x * 0.98, uRingShadow.x, r)
          * (1.0 - smoothstep(uRingShadow.y, uRingShadow.y * 1.02, r));
        light *= 1.0 - inRing * uRingShadow.z;
      }
    }
  }
  return light;
}
`;

export interface ShadowCaster {
  position: Vector3;
  radius: number;
}

export function createShadowUniforms(): Record<string, { value: unknown }> {
  return {
    uOccluderCount: { value: 0 },
    uOccluders: {
      value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()],
    },
    uStarAngularRadius: { value: 0.0047 },
    uRingShadow: { value: new Vector4(0, 0, 0, 0) },
    uRingNormal: { value: new Vector3(0, 1, 0) },
  };
}

export function applyOccluders(
  material: ShaderMaterial,
  occluders: ShadowCaster[],
  starAngularRadius: number,
): void {
  const uniforms = material.uniforms;
  if (!uniforms.uOccluderCount) return;
  const count = Math.min(occluders.length, 4);
  uniforms.uOccluderCount.value = count;
  for (let i = 0; i < count; i++) {
    (uniforms.uOccluders.value as Vector4[])[i].set(
      occluders[i].position.x,
      occluders[i].position.y,
      occluders[i].position.z,
      occluders[i].radius,
    );
  }
  uniforms.uStarAngularRadius.value = starAngularRadius;
}
