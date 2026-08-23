import { Color, DoubleSide, ShaderMaterial } from 'three';

const VERTEX = /* glsl */ `
attribute vec3 color;

varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewPos;

void main() {
  vColor = color;
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewPos;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uFogColor;
uniform float uFogDensity;

void main() {
  // Light direction arrives in view space alongside the normals.
  float diffuse = max(dot(normalize(vNormal), uLightDir), 0.0);
  vec3 color = vColor * uLightColor * (diffuse + 0.015);

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
