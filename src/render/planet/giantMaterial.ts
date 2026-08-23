import { Color, ShaderMaterial } from 'three';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from './shadows';
import { planetSeedOffset } from './solidPlanetMaterial';

const VERTEX = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vObjPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSeedOffset;
uniform vec3 uZoneColor;
uniform vec3 uBeltColor;
uniform vec3 uStormColor;
uniform vec3 uThermalColor;
uniform float uBandCount;
uniform float uTurbulence;
uniform float uMajorStormSize;
uniform float uThermalStrength;
uniform float uTimeDays;
uniform float uSpinRadPerDay;

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

void main() {
  vec3 p = normalize(vObjPos);
  float latitude = asin(clamp(p.y, -1.0, 1.0));

  // Alternating zonal jets shear the clouds differentially with latitude.
  vec3 ps = rotateY(p, uTimeDays * uSpinRadPerDay * 0.12 * sin(latitude * 5.0));

  // Bands: latitude stripes warped by shear eddies elongated along the flow.
  float warp = uTurbulence * 0.1 * fbm(vec3(ps.x, ps.y * 3.5, ps.z) * 2.8 + uSeedOffset);
  float bandCoord = sin((p.y + warp) * 3.14159 * uBandCount);
  float bandMix = smoothstep(-0.55, 0.55, bandCoord);
  vec3 surface = mix(uBeltColor, uZoneColor, bandMix);

  // Small storm ovals: longitude-stretched noise along belt edges.
  float stormField = fbm(vec3(ps.x, ps.y * 4.0, ps.z) * 2.6 + uSeedOffset.zxy);
  float storms = smoothstep(0.55, 0.75, stormField) * uTurbulence;
  surface = mix(surface, uStormColor, storms * 0.7);

  // Great-spot analog: one persistent anticyclone at a fixed latitude.
  if (uMajorStormSize > 0.0) {
    float longitude = atan(ps.z, ps.x);
    float dLat = (latitude + 0.35) / (uMajorStormSize * 1.6);
    float dLon = (longitude - 0.9) / (uMajorStormSize * 3.2);
    float spot = exp(-(dLat * dLat + dLon * dLon));
    surface = mix(surface, uStormColor, spot * 0.85);
  }

  // Poles darken slightly (aerosol hoods).
  surface *= 1.0 - 0.25 * pow(abs(p.y), 6.0);

  vec3 normal = normalize(vWorldNormal);
  float ndotl = dot(normal, uLightDir);
  float diffuse = max(ndotl, 0.0) * shadowFactor(vWorldPos, uLightDir);

  // Gentle limb darkening on the cloud deck.
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float mu = clamp(dot(normal, viewDir), 0.0, 1.0);
  float limb = 1.0 - 0.45 * (1.0 - mu);

  vec3 color = surface * uLightColor * (diffuse + 0.004) * limb;

  // Hot giants radiate their own heat on the night side.
  float night = 1.0 - smoothstep(-0.1, 0.2, ndotl);
  color += uThermalColor * uThermalStrength * mix(0.35, 1.0, night) * limb;

  gl_FragColor = vec4(color, 1.0);
}
`;

export function createGiantMaterial(physical: Characterization): ShaderMaterial {
  const banding = physical.appearance.banding!;
  const spin = (2 * Math.PI * 24) / physical.rotation.periodHours;
  const glowing = banding.thermalGlowK > 700;
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
      uZoneColor: { value: banding.zoneColor },
      uBeltColor: { value: banding.beltColor },
      uStormColor: { value: banding.stormColor },
      uThermalColor: { value: glowing ? blackbodyLinearRgb(banding.thermalGlowK) : [0, 0, 0] },
      uBandCount: { value: banding.bandCount },
      uTurbulence: { value: banding.turbulence },
      uMajorStormSize: { value: banding.majorStormSize },
      uThermalStrength: { value: glowing ? Math.min(1, (banding.thermalGlowK / 1800) ** 4) : 0 },
      uTimeDays: { value: 0 },
      uSpinRadPerDay: { value: spin },
    },
  });
}
