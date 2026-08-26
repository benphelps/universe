import { BufferGeometry, Color, IcosahedronGeometry, ShaderMaterial } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';

const VERTEX = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vViewPos;

void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    n = mat3(instanceMatrix) * n;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(0.4);
  #endif
  // Chunk-anchored groups never rotate: model rotation is identity.
  vNormal = normalize(n);
  vec4 worldPos = modelMatrix * local;
  vec4 mvPosition = viewMatrix * worldPos;
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
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uFogColor;
uniform float uFogDensity;

void main() {
  float diffuse = max(dot(normalize(vNormal), uLightDir), 0.0);
  float diffuse2 = max(dot(normalize(vNormal), uLight2Dir), 0.0);
  vec3 color = vColor * (uLightColor * (diffuse + 0.02) + uLight2Color * diffuse2);
  float fog = 1.0 - exp(-length(vViewPos) * uFogDensity);
  gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
}
`;

/** Shared by every scatter instance; per-frame uniforms set by the viewer. */
export function createScatterMaterial(): ShaderMaterial {
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
  });
}

/** Deterministically lumpy unit rock, shared by every boulder instance. */
export function createRockGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(0.55, 1);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    // Hash-displaced vertices: irregular but identical every run.
    const wobble =
      1 +
      0.34 * Math.sin(x * 37.7 + y * 17.3 + z * 51.1) +
      0.18 * Math.sin(x * 91.3 - z * 63.7);
    positions.setXYZ(i, x * wobble, y * wobble * 0.8, z * wobble);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Broad low tuft for ground cover, shared by every shrub instance. */
export function createShrubGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(0.6, 1);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const wobble = 1 + 0.42 * Math.sin(x * 53.9 + y * 29.1 + z * 77.3);
    positions.setXYZ(i, x * wobble, Math.max(-0.1, y * 0.55 * wobble), z * wobble);
  }
  geometry.computeVertexNormals();
  return geometry;
}
