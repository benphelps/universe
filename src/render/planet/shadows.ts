import { ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';

/**
 * Analytic eclipse shadows: spherical occluders (moons shadowing their
 * planet, planets eclipsing their moons) tested along the star ray per
 * fragment, with penumbra width set by the star's angular size; plus the
 * shadow a ring system casts on its planet — transmission through the
 * ring slab along the slanted ray, carrying the ring's own ringlet and
 * gap structure so Cassini-style bright lanes cross the deck.
 * Requires SIMPLEX_NOISE_GLSL spliced in before this chunk (snoise).
 */
export const SHADOW_GLSL = /* glsl */ `
uniform int uOccluderCount;
uniform vec4 uOccluders[4];
uniform float uStarAngularRadius;
uniform vec4 uRingShadow;               // inner, outer, optical depth, gate
uniform vec3 uRingNormal;
uniform vec3 uRingCenter;
uniform float uRingSeed;
uniform int uRingGapCount;
uniform vec2 uRingGaps[6];              // center, width

// Radial density of the ring slab, shared by the ring's own shading
// and the shadow it casts. Units follow uRingShadow.xy / uRingGaps —
// object-local for the ring mesh, world for the shadow band. wR is
// the pixel footprint in those units: octaves mip out against it, and
// sub-pixel gaps widen to it (diluted to keep their blocked light
// honest) — else the band moires and the gap lines dash.
float ringDensity(float r, float wR) {
  float span = uRingShadow.y - uRingShadow.x;
  float rNorm = (r - uRingShadow.x) / span;
  float wNorm = wR / span;
  float structure = 0.6
    + 0.3 * (1.0 - smoothstep(0.25, 0.5, wNorm * 22.0))
        * snoise(vec3(rNorm * 22.0, uRingSeed, 0.0))
    + 0.2 * (1.0 - smoothstep(0.25, 0.5, wNorm * 71.0))
        * snoise(vec3(rNorm * 71.0, uRingSeed + 9.0, 0.0));
  float density = clamp(structure, 0.05, 1.2);
  for (int i = 0; i < 6; i++) {
    if (i >= uRingGapCount) break;
    float d = abs(r - uRingGaps[i].x);
    float wGap = max(uRingGaps[i].y, wR * 2.0);
    float carve = mix(0.04, 1.0, smoothstep(wGap * 0.5, wGap, d));
    density *= mix(1.0, carve, clamp(uRingGaps[i].y / wGap, 0.0, 1.0));
  }
  return density * smoothstep(0.0, 0.06, rNorm) * (1.0 - smoothstep(0.92, 1.0, rNorm));
}

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
      vec3 rel = worldPos - uRingCenter;
      float t = -dot(uRingNormal, rel) / denom;
      float r = length(rel + lightDir * t);
      // Footprint before the ray test: derivatives want uniform flow.
      float wR = fwidth(r);
      if (t > 0.0 && r > uRingShadow.x * 0.8 && r < uRingShadow.y * 1.1) {
        // A low sun crosses the slab at a shallow angle: the longer
        // path deepens the shadow, so it darkens toward equinox
        // seasons exactly when it thins toward the equator.
        light *= exp(-uRingShadow.z * ringDensity(r, wR) / max(abs(denom), 0.05));
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
    uRingCenter: { value: new Vector3() },
    uRingSeed: { value: 0 },
    uRingGapCount: { value: 0 },
    uRingGaps: {
      value: Array.from({ length: 6 }, () => new Vector2()),
    },
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
