import { ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import type { RingSystem } from '../../universe/rings/types';

/**
 * Analytic eclipse shadows: spherical occluders (moons shadowing their
 * planet, planets eclipsing their moons) tested along the star ray per
 * fragment, with penumbra width set by that light's angular size; plus the
 * shadow a ring system casts on its planet — transmission through the
 * ring slab along the slanted ray, carrying the ring's own ringlet and
 * gap structure so Cassini-style bright lanes cross the deck.
 * Requires SIMPLEX_NOISE_GLSL spliced in before this chunk (snoise).
 */
export const SHADOW_GLSL = /* glsl */ `
uniform int uOccluderCount;
uniform vec4 uOccluders[4];
uniform float uStarAngularRadius;
uniform float uStar2AngularRadius;
uniform float uLight2Reach;             // distance to the second light's source
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

// Light surviving along the ray toward a source of this angular
// radius standing this far away: each light carries its own, so a
// binary's two penumbrae take their own widths, and a body shining
// by reflection — itself in the occluder list — cannot eclipse its
// own light from beyond its own surface.
float shadowFactor(vec3 worldPos, vec3 lightDir, float starAngularRadius, float reach) {
  float light = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uOccluderCount) break;
    vec3 toOccluder = uOccluders[i].xyz - worldPos;
    float along = dot(toOccluder, lightDir);
    if (along <= 0.0 || along >= reach) continue;
    float closest = length(toOccluder - along * lightDir);
    float penumbra = uOccluders[i].w + along * starAngularRadius;
    float umbra = max(uOccluders[i].w - along * starAngularRadius, 0.0);
    // A body smaller on the sky than the star covers at most its own
    // share of the disc: a small moon far off transits, it does not
    // eclipse.
    float sunRadius = max(along * starAngularRadius, 1e-6);
    float cover = min(1.0, (uOccluders[i].w / sunRadius) * (uOccluders[i].w / sunRadius));
    light *= 1.0 - cover * (1.0 - smoothstep(umbra, penumbra, closest));
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
    uStar2AngularRadius: { value: 0.0047 },
    uLight2Reach: { value: 1e30 },
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

/** The seeded radial pattern is shared between the ring's own shading
 *  and the shadow band it casts, so gaps line up with bright lanes. */
export function ringPatternSeed(rings: RingSystem): number {
  return (rings.innerPlanetRadii * 137.3) % 100;
}

/**
 * Stand a ring system's shadow band over a material: plane, bounds,
 * and gap structure in the material's world units, gated on. Shared
 * by a planet sphere and the terrain family standing in for one.
 */
export function applyRingShadow(
  material: ShaderMaterial,
  rings: RingSystem,
  center: Vector3,
  planetRadius: number,
  normal: Vector3,
): void {
  const uniforms = material.uniforms;
  if (!uniforms.uRingShadow) return;
  (uniforms.uRingShadow.value as Vector4).set(
    rings.innerPlanetRadii * planetRadius,
    rings.outerPlanetRadii * planetRadius,
    rings.opticalDepth,
    1,
  );
  (uniforms.uRingCenter.value as Vector3).copy(center);
  (uniforms.uRingNormal.value as Vector3).copy(normal);
  uniforms.uRingSeed.value = ringPatternSeed(rings);
  const gaps = rings.gaps.slice(0, 6);
  uniforms.uRingGapCount.value = gaps.length;
  for (let i = 0; i < gaps.length; i++) {
    (uniforms.uRingGaps.value as Vector2[])[i].set(
      gaps[i].radiusPlanetRadii * planetRadius,
      gaps[i].widthPlanetRadii * planetRadius,
    );
  }
}

export function clearRingShadow(material: ShaderMaterial): void {
  const uniforms = material.uniforms;
  if (uniforms.uRingShadow) (uniforms.uRingShadow.value as Vector4).w = 0;
}

/** Mirror of the shader's occluder test for one point on the CPU —
 *  what the eye's own patch of sky keeps of a light. */
export function shadowAt(
  point: Vector3,
  lightDir: Vector3,
  occluders: readonly ShadowCaster[],
  starAngularRadius: number,
): number {
  let light = 1;
  const to = new Vector3();
  for (const occluder of occluders.slice(0, 4)) {
    to.copy(occluder.position).sub(point);
    const along = to.dot(lightDir);
    if (along <= 0) continue;
    const closest = to.addScaledVector(lightDir, -along).length();
    const penumbra = occluder.radius + along * starAngularRadius;
    const umbra = Math.max(occluder.radius - along * starAngularRadius, 0);
    const sunRadius = Math.max(along * starAngularRadius, 1e-6);
    const cover = Math.min(1, (occluder.radius / sunRadius) ** 2);
    const t = Math.min(1, Math.max(0, (closest - umbra) / Math.max(penumbra - umbra, 1e-9)));
    light *= 1 - cover * (1 - t * t * (3 - 2 * t));
  }
  return light;
}
