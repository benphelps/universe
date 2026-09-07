import { Color, DoubleSide, ShaderMaterial } from 'three';
import { seasonalSurfaceUniforms, SEASONAL_SURFACE_GLSL } from './seasonalSurface';
import { thermalUniforms, ownThermalTexture, THERMAL_EMISSION_GLSL } from '../lighting/thermalMaterial';
import { SECOND_SUN_GLSL, secondSunUniforms } from '../lighting/secondSun';
import { SURFACE_LIGHT_GLSL, surfaceLightUniforms } from '../lighting/surfaceLight';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from '../planet/shadows';
import { TERRAIN_MORPH_GLSL } from './terrainMorph';

const VERTEX = /* glsl */ `
uniform float uPlanetRadius;
attribute vec3 color;
attribute vec4 aMorph;

${TERRAIN_MORPH_GLSL}

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;
varying float vSurfaceAltitudeKm;

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
  // Interpolate sampled elevation, not the radius of a flat triangle's
  // interior chord: that invents cold/warm grids at orbital terrain LOD.
  vSurfaceAltitudeKm = length(vWorldPos) - uPlanetRadius;

  // Geomorph: aMorph.xyz is this vertex's offset from the parent mesh
  // surface, removed entirely at the distance where this tile swapped
  // in for its parent (2·size/ratio) — so the swap is invisible — and
  // restored on approach, fully before this tile's own children arrive
  // (size/ratio). Adjacent LOD rings agree at their shared boundary by
  // the same rule.
  vec3 displaced = morphTerrainPosition(position, aMorph.xyz, position, aMorph.w);

  vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
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
varying float vSurfaceAltitudeKm;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
${SECOND_SUN_GLSL}
${THERMAL_EMISSION_GLSL}
${SEASONAL_SURFACE_GLSL}

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

void main() {
  // Subtle mineral variation in physical kilometers. Filter each octave
  // by its pixel footprint so distant slopes do not sparkle or moire.
  vec3 dir = normalize(vWorldPos);
  vec3 p = dir * uPlanetRadius;
  float mottle = 1.0;
  mottle += 0.065 * snoise(p / 1.8) * (1.0 - smoothstep(0.25, 0.8, length(fwidth(p / 1.8))));
  mottle += 0.045 * snoise(p / 0.14) * (1.0 - smoothstep(0.25, 0.8, length(fwidth(p / 0.14))));
  mottle += 0.025 * snoise(p / 0.012) * (1.0 - smoothstep(0.25, 0.8, length(fwidth(p / 0.012))));
  vec3 ground = vColor * mottle;
  // Terrain already supplies geometric relief down to walking scale.
  // Unrelated tangent noise invented bumps and a seam at the polar basis.
  vec3 normal = normalize(vNormal);
  ground = seasonalSnow(ground, dir, normal, vSurfaceAltitudeKm, mottle);

  // Each sun through the column above this ground, eclipsed by any
  // moon or ring standing in its way. Night illumination comes only
  // from physical secondary sources supplied by the viewer.
  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, normal, dir, shadow, diffuseShadow(shadow));
  bool lit2 = secondSunLit();
  if (lit2) {
    float shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    light += surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, normal, dir, shadow2, diffuseShadow(shadow2));
  }
  vec3 color = ground * light + (vec3(1.0) - clamp(ground, 0.0, 1.0)) * surfaceThermal(uSurfaceTemperatureK);

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
  vec3 seen = color * exp(-column)
    + uLightColor * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLightDir), -dot(toEye, uLightDir)) * airShadow;
  if (lit2) {
    float airShadow2 = shadowFactor(midPoint, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    seen += uLight2Color * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLight2Dir), -dot(toEye, uLight2Dir)) * airShadow2;
  }
  gl_FragColor = vec4(seen, 1.0);
}
`;

/** Shared by every chunk of a planet; per-frame uniforms set by the viewer.
 *  splitRatio must match the chunk streamer's, or geomorph completes at
 *  the wrong distances and swaps pop again. */
export function createTerrainMaterial(splitRatio: number): ShaderMaterial {
  return ownThermalTexture(new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...surfaceLightUniforms(),
      uSplitRatio: { value: splitRatio },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      ...thermalUniforms(),
      ...seasonalSurfaceUniforms(),
    },
    side: DoubleSide,
  }));
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
