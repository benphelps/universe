import { Color, ShaderMaterial } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
import { MAGMA_PATTERN_GLSL } from '../glsl/magmaPattern';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';

const VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;

void main() {
  vNormal = normal;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;

uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uFogColor;
uniform float uFogDensity;

void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, uLightDir), 0.0);

  // World-space view direction (v·M applies the view rotation's inverse);
  // water tiles never rotate, so normals are already world-frame.
  vec3 viewDir = normalize(-vViewPos) * mat3(viewMatrix);

  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.0);
  vec3 halfDir = normalize(uLightDir + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), 220.0);

  float diffuse2 = max(dot(normal, uLight2Dir), 0.0);
  vec3 color = uColor * (uLightColor * (diffuse + 0.02) + uLight2Color * diffuse2)
    + uLightColor * (fresnel * 0.25 * diffuse + specular * diffuse);

  float fog = 1.0 - exp(-length(vViewPos) * uFogDensity);
  gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
}
`;

/**
 * Sea-surface material for chunk-aligned water tiles: fresnel-brightened
 * at grazing angles with a sun glint, sharing the terrain's aerial fog.
 * All lighting is world-frame (tiles never rotate). No polygon offset:
 * a slope-scaled depth bias floods shorelines at grazing view angles —
 * the shared-grid geometry and the altitude-scaled near plane make the
 * true depth test reliable on their own.
 */
export function createOceanMaterial(oceanColor: [number, number, number]): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: new Color(...oceanColor) },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uFogColor: { value: new Color(0, 0, 0) },
      uFogDensity: { value: 0 },
    },
  });
}

const MAGMA_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

void main() {
  vNormal = normal;
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const MAGMA_FRAGMENT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uSeedOffset;
uniform float uTimeDays;

${SIMPLEX_NOISE_GLSL}
${MAGMA_PATTERN_GLSL}

void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, uLightDir), 0.0);
  vec3 viewDir = normalize(-vViewPos) * mat3(viewMatrix);

  vec3 glow = magmaGlow(vWorldPos, uSeedOffset, uTimeDays, length(fwidth(vWorldPos)));
  float lum = dot(glow, vec3(0.3, 0.59, 0.11));

  // The sheen belongs to the melt: open lava is glassy-fluid, chilled
  // crust is matte rubble, and the surface is anything but smooth —
  // the flow pattern itself bumps the specular normal, so the glint
  // breaks along the filaments instead of pooling into a polished blob.
  vec3 sx = dFdx(vWorldPos);
  vec3 sy = dFdy(vWorldPos);
  vec3 tx = normalize(sx - normal * dot(sx, normal) + vec3(1e-6));
  vec3 ty = normalize(sy - normal * dot(sy, normal) + vec3(1e-6));
  float gx = clamp(dFdx(lum) / max(length(sx), 1e-5) * 2.0, -0.5, 0.5);
  float gy = clamp(dFdy(lum) / max(length(sy), 1e-5) * 2.0, -0.5, 0.5);
  vec3 bumped = normalize(normal - gx * tx - gy * ty);

  float hot = smoothstep(0.2, 0.9, lum);
  float fresnel = pow(1.0 - max(dot(bumped, viewDir), 0.0), 4.0);
  vec3 halfDir = normalize(uLightDir + viewDir);
  float specular = pow(max(dot(bumped, halfDir), 0.0), 90.0) * (0.25 + 0.75 * hot);
  float diffuse2 = max(dot(normal, uLight2Dir), 0.0);
  vec3 color = uColor * (uLightColor * (diffuse + 0.02) + uLight2Color * diffuse2)
    + uLightColor * (fresnel * 0.05 + specular * 0.18) * diffuse
    + glow;

  float fog = 1.0 - exp(-length(vViewPos) * uFogDensity);
  gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
}
`;

/** Magma-sea surface for the same water tiles: chilled plates over an
 *  incandescent crack lattice, emitting its own light day and night. */
export function createMagmaMaterial(
  crustColor: [number, number, number],
  seedOffset: [number, number, number],
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: MAGMA_VERTEX,
    fragmentShader: MAGMA_FRAGMENT,
    uniforms: {
      uColor: { value: new Color(...crustColor) },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uFogColor: { value: new Color(0, 0, 0) },
      uFogDensity: { value: 0 },
      uSeedOffset: { value: seedOffset },
      uTimeDays: { value: 0 },
    },
  });
}
