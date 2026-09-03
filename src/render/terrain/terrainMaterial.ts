import { Color, DoubleSide, ShaderMaterial } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
import { SURFACE_LIGHT_GLSL, surfaceLightUniforms } from '../lighting/surfaceLight';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from '../planet/shadows';

const VERTEX = /* glsl */ `
attribute vec3 color;
attribute vec2 aMorph;

uniform float uSplitRatio;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

void main() {
  vColor = color;
  // Chunk meshes never rotate: attribute normals are world-frame already.
  vNormal = normal;
  // World position only feeds planet-frame noise directions: its f32
  // rounding is a static sub-arcsecond error. The clip transform must
  // run through modelViewMatrix — its translation is composed camera-
  // relative on the CPU in f64. Materializing worldPos and applying
  // viewMatrix on the GPU subtracts two planet-radius f32 values and
  // makes the ground shake at eye height.
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;

  // Geomorph: aMorph.x is this vertex's height above the parent-LOD
  // surface, removed entirely at the distance where this tile swapped
  // in for its parent (2·size/ratio) — so the swap is invisible — and
  // restored on approach, fully before this tile's own children arrive
  // (size/ratio). Adjacent LOD rings agree at their shared boundary by
  // the same rule.
  float swapInKm = 2.0 * aMorph.y / uSplitRatio;
  float viewKm = length((modelViewMatrix * vec4(position, 1.0)).xyz);
  float morph = clamp((swapInKm - viewKm) / (0.8 * aMorph.y / uSplitRatio), 0.0, 1.0);
  vec3 displaced = position - normalize(vWorldPos) * (aMorph.x * (1.0 - morph));

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

void main() {
  // Per-fragment ground mottling: color detail beyond vertex resolution,
  // stable in the planet frame at any LOD.
  vec3 dir = normalize(vWorldPos);
  float mottle = 1.0
    + 0.10 * snoise(dir * 900.0)
    + 0.07 * snoise(dir * 5200.0)
    + 0.05 * snoise(dir * 26000.0);
  vec3 ground = vColor * mottle;

  // Micro-relief shading: perturb the normal with the same planet-frame
  // noise so surface roughness looks uniform across LOD ring boundaries.
  vec3 tangentA = normalize(abs(dir.y) > 0.98
    ? cross(dir, vec3(1.0, 0.0, 0.0))
    : cross(dir, vec3(0.0, 1.0, 0.0)));
  vec3 tangentB = cross(dir, tangentA);
  float bumpFade = 1.0 / (1.0 + length(vViewPos) * 0.0001);
  vec3 normal = normalize(
    normalize(vNormal)
    + bumpFade * 0.22 * (tangentA * snoise(dir * 3100.0 + 7.0) + tangentB * snoise(dir * 3100.0 + 13.0))
    + bumpFade * 0.12 * (tangentA * snoise(dir * 17000.0 + 3.0) + tangentB * snoise(dir * 17000.0 + 29.0))
  );

  // Each sun through the column above this ground, eclipsed by any
  // moon or ring standing in its way; the night keeps the sky's own
  // glow as the viewer's adaptation allows.
  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  float shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, normal, dir, shadow, diffuseShadow(shadow))
    + surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, normal, dir, shadow2, diffuseShadow(shadow2));
  vec3 color = ground * (light + uNightFloor);

  // Aerial perspective: the air along the run to the eye keeps some of
  // the ground's light and adds the sunlight it scatters — blue by day,
  // red under a low sun, nothing in a vacuum.
  float eyeAlt = length(cameraPosition) - uPlanetRadius;
  float pointAlt = length(vWorldPos) - uPlanetRadius;
  float run = length(vViewPos);
  vec3 column = airSegmentColumn(eyeAlt, pointAlt, run);
  vec3 midUp = normalize(0.5 * (cameraPosition + vWorldPos));
  vec3 midPoint = 0.5 * (cameraPosition + vWorldPos);
  vec3 toEye = normalize(cameraPosition - vWorldPos);
  float airShadow = shadowFactor(midPoint, uLightDir, uStarAngularRadius, 1e30);
  float airShadow2 = shadowFactor(midPoint, uLight2Dir, uStar2AngularRadius, uLight2Reach);
  vec3 seen = color * exp(-column)
    + uLightColor * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLightDir), -dot(toEye, uLightDir)) * airShadow
    + uLight2Color * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLight2Dir), -dot(toEye, uLight2Dir)) * airShadow2;
  gl_FragColor = vec4(seen, 1.0);
}
`;

/** Shared by every chunk of a planet; per-frame uniforms set by the viewer.
 *  splitRatio must match the chunk streamer's, or geomorph completes at
 *  the wrong distances and swaps pop again. */
export function createTerrainMaterial(splitRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...surfaceLightUniforms(),
      uSplitRatio: { value: splitRatio },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
    },
    side: DoubleSide,
  });
}

/** Grid + skirt index template, shared by all chunks of one resolution. */
export function buildChunkIndices(res: number): Uint32Array {
  const stride = res + 1;
  const gridCount = stride * stride;
  const indices: number[] = [];
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Skirt quads: edge vertices to their dropped copies.
  const edgeIndex = (side: number, k: number): number => {
    switch (side) {
      case 0: return k;
      case 1: return res * stride + k;
      case 2: return k * stride;
      default: return k * stride + res;
    }
  };
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < res; k++) {
      const e0 = edgeIndex(side, k);
      const e1 = edgeIndex(side, k + 1);
      const s0 = gridCount + side * stride + k;
      const s1 = s0 + 1;
      indices.push(e0, e1, s0, e1, s1, s0);
    }
  }
  return new Uint32Array(indices);
}
