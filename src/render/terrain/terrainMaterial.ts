import { Color, DoubleSide, ShaderMaterial } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';

const VERTEX = /* glsl */ `
attribute vec3 color;

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
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
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
uniform vec3 uFogColor;
uniform float uFogDensity;

${SIMPLEX_NOISE_GLSL}

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

  float diffuse = max(dot(normal, uLightDir), 0.0);
  float diffuse2 = max(dot(normal, uLight2Dir), 0.0);
  vec3 color = ground * (uLightColor * (diffuse + 0.015) + uLight2Color * diffuse2);

  // Aerial perspective toward the sky's horizon tint.
  float fog = 1.0 - exp(-length(vViewPos) * uFogDensity);
  gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
}
`;

/** Shared by every chunk of a planet; per-frame uniforms set by the viewer. */
export function createTerrainMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uFogColor: { value: new Color(0, 0, 0) },
      uFogDensity: { value: 0 },
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
