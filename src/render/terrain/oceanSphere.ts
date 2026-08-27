import { Color, ShaderMaterial } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
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

void main() {
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, uLightDir), 0.0);
  vec3 viewDir = normalize(-vViewPos) * mat3(viewMatrix);

  // A lava lake wears a thin chilled crust of drifting dark plates;
  // the melt shows through the crack lattice between them and pools
  // open where the lake runs hot. World-frame kilometers, so the
  // pattern holds still while the camera moves.
  vec3 q = vWorldPos * 0.25 + uSeedOffset;
  float drift = uTimeDays * 0.15;
  float lattice = 1.0 - abs(snoise(q + vec3(0.0, 0.0, drift)));
  lattice = max(lattice, 0.85 * (1.0 - abs(snoise(q * 3.1 - uSeedOffset.yzx
    + vec3(drift * 1.7, 0.0, 0.0)))));
  // Below the crack wavelength the lattice hands off to its mean:
  // orbit sees calm glow, not per-pixel speckle.
  float texelKm = length(fwidth(vWorldPos));
  float detailGate = 1.0 - smoothstep(0.6, 2.8, texelKm);
  float crack = mix(0.16, pow(lattice, 7.0), detailGate);
  // Open melt pools cluster along active provinces, the way paterae
  // do — a uniform sprinkle reads as noise from orbit.
  float cluster = 0.5 + 0.5 * snoise(vWorldPos * 0.0025 + uSeedOffset.yxz);
  float activity = 0.5 + 0.5 * snoise(vWorldPos * 0.012 + uSeedOffset.zxy
    + vec3(0.0, drift * 0.2, 0.0));
  float open = smoothstep(0.82, 0.98, activity * (0.45 + 0.75 * cluster));

  vec3 melt = vec3(1.0, 0.3, 0.05);
  vec3 glow = melt * (0.04 + 1.4 * crack + 1.1 * open) * (0.55 + 0.45 * activity);

  // The crust still reflects the star; molten glass keeps a sheen.
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.0);
  vec3 halfDir = normalize(uLightDir + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), 120.0);
  float diffuse2 = max(dot(normal, uLight2Dir), 0.0);
  vec3 color = uColor * (uLightColor * (diffuse + 0.02) + uLight2Color * diffuse2)
    + uLightColor * (fresnel * 0.12 + specular * 0.35) * diffuse
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
