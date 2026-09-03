import { Color, ShaderMaterial } from 'three';
import { SECOND_SUN_GLSL, secondSunUniforms } from '../lighting/secondSun';
import { SURFACE_LIGHT_GLSL, surfaceLightUniforms } from '../lighting/surfaceLight';
import { MAGMA_PATTERN_GLSL } from '../glsl/magmaPattern';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from '../planet/shadows';

const VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

void main() {
  vNormal = normal;
  // Shadow rays only; clip runs through modelViewMatrix — see terrainMaterial.
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
${SECOND_SUN_GLSL}

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

// One sun's glint and grazing sheen off level water: the beam that
// reaches the surface, off the facet toward the eye.
vec3 sunSheen(vec3 normal, vec3 viewDir, vec3 lightDir, vec3 lightColor, float shadow) {
  float mu = dot(normal, lightDir);
  float fresnel = pow(clamp(1.0 - dot(normal, viewDir), 0.0, 1.0), 4.0);
  vec3 halfDir = normalize(lightDir + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), 220.0);
  return lightColor * beamTransmittance(uOpticalDepth, mu)
    * (fresnel * 0.25 + specular) * max(mu, 0.0) * shadow;
}

void main() {
  // Water lies level: its normal is the local vertical.
  vec3 normal = normalize(vNormal);

  // World-space view direction (v·M applies the view rotation's inverse);
  // water tiles never rotate, so normals are already world-frame.
  vec3 viewDir = normalize(-vViewPos) * mat3(viewMatrix);

  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, normal, normal, shadow, diffuseShadow(shadow));
  vec3 sheen = sunSheen(normal, viewDir, uLightDir, uLightColor, shadow);
  bool lit2 = secondSunLit();
  if (lit2) {
    float shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    light += surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, normal, normal, shadow2, diffuseShadow(shadow2));
    sheen += sunSheen(normal, viewDir, uLight2Dir, uLight2Color, shadow2);
  }
  vec3 color = uColor * (light + uNightFloor) + sheen;

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
      ...createShadowUniforms(),
      ...surfaceLightUniforms(),
      uColor: { value: new Color(...oceanColor) },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
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
${SECOND_SUN_GLSL}
uniform vec3 uSeedOffset;
uniform float uTimeDays;

${SIMPLEX_NOISE_GLSL}
${MAGMA_PATTERN_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

// One sun's glint off the melt's broken facets.
vec3 meltSheen(vec3 bumped, vec3 up, vec3 viewDir, vec3 lightDir, vec3 lightColor, float hot, float shadow) {
  float mu = dot(up, lightDir);
  float fresnel = pow(clamp(1.0 - dot(bumped, viewDir), 0.0, 1.0), 4.0);
  vec3 halfDir = normalize(lightDir + viewDir);
  float specular = pow(max(dot(bumped, halfDir), 0.0), 90.0) * (0.25 + 0.75 * hot);
  return lightColor * beamTransmittance(uOpticalDepth, mu)
    * (fresnel * 0.05 + specular * 0.18) * max(mu, 0.0) * shadow;
}

void main() {
  vec3 normal = normalize(vNormal);
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
  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, normal, normal, shadow, diffuseShadow(shadow));
  vec3 sheen = meltSheen(bumped, normal, viewDir, uLightDir, uLightColor, hot, shadow);
  bool lit2 = secondSunLit();
  float shadow2 = 1.0;
  if (lit2) {
    shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    light += surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, normal, normal, shadow2, diffuseShadow(shadow2));
    sheen += meltSheen(bumped, normal, viewDir, uLight2Dir, uLight2Color, hot, shadow2);
  }
  vec3 color = uColor * (light + uNightFloor) + sheen + glow;

  // Aerial perspective: the air along the run to the eye keeps some of
  // the ground's light and adds the sunlight it scatters — blue by day,
  // red under a low sun, nothing in a vacuum.
  float eyeAlt = length(cameraPosition) - uPlanetRadius;
  float pointAlt = length(vWorldPos) - uPlanetRadius;
  float run = length(vViewPos);
  vec3 column = airSegmentColumn(eyeAlt, pointAlt, run);
  vec3 midUp = normalize(0.5 * (cameraPosition + vWorldPos));
  vec3 toEye = normalize(cameraPosition - vWorldPos);
  vec3 seen = color * exp(-column)
    + uLightColor * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLightDir), -dot(toEye, uLightDir)) * shadow;
  if (lit2) {
    seen += uLight2Color * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLight2Dir), -dot(toEye, uLight2Dir)) * shadow2;
  }
  gl_FragColor = vec4(seen, 1.0);
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
      ...createShadowUniforms(),
      ...surfaceLightUniforms(),
      uColor: { value: new Color(...crustColor) },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSeedOffset: { value: seedOffset },
      uTimeDays: { value: 0 },
    },
  });
}
