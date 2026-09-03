import { Color, ShaderMaterial, Vector3 } from 'three';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import { type Circulation } from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { WORLD_NORMAL_GLSL } from '../glsl/worldNormal';
import { secondSunUniforms } from '../lighting/secondSun';
import {
  horizonAirmass,
  SURFACE_LIGHT_GLSL,
  surfaceLightUniforms,
} from '../lighting/surfaceLight';
import { deckOpticalDepth } from '../../universe/planet/atmosphere';
import { HEIGHT_SCALE } from './giantPattern';
import { createShadowUniforms, SHADOW_GLSL } from './shadows';
import { planetSeedOffset } from './solidPlanetMaterial';
import { AIR_REFRACT_GLSL, AIR_VIEW_GLSL, airViewUniforms } from '../lighting/airView';

const VERTEX = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

${WORLD_NORMAL_GLSL}

${AIR_REFRACT_GLSL}

void main() {
  vObjPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = worldNormal(modelMatrix, normal);
  gl_Position = projectionMatrix * viewMatrix * vec4(airRefractPosition(worldPos.xyz), 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

uniform samplerCube uDeckA;
uniform samplerCube uDeckB;
uniform float uDeckMix;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uSeedOffset;
uniform float uTimeDays;
uniform float uContrast;
uniform float uChurnPerDay;
uniform vec2 uPolarCaps;                // north/south cap boundary latitude
uniform float uCloudReliefKm;
uniform float uRegime;                  // 0 banded, 1 locked
uniform vec3 uHotspotDirObj;
uniform vec3 uThermalColor;
uniform float uThermalStrength;

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}
${AIR_VIEW_GLSL}

void main() {
  vec3 p = normalize(vObjPos);
  // The deck lives in a mipmapped cubemap: uniform texel density over
  // the whole sphere (no pole singularity), hardware-antialiased at
  // every distance. Two bakes at nearby sim times crossfade, so the
  // weather moves between them.
  vec4 deck = mix(textureCube(uDeckA, p), textureCube(uDeckB, p), uDeckMix);
  vec3 surface = deck.rgb;
  float cloudH = deck.a / ${HEIGHT_SCALE.toFixed(2)};

  // One procedural octave rides on top for approach closer than the
  // bake's texels; it needs no band bookkeeping, so it cannot seam.
  float footprint = length(fwidth(p));
  float microGate = 1.0 - smoothstep(0.00015, 0.0012, footprint);
  if (microGate > 0.01) {
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float capEdge = p.y >= 0.0 ? uPolarCaps.x : uPolarCaps.y;
    float zonalMicro = 1.0 - smoothstep(capEdge - 0.18, capEdge + 0.04, abs(lat));
    float micro = fbm(vec3(p.x, p.y * 2.5, p.z) * 30.0 + uSeedOffset
      + vec3(0.0, 0.0, uTimeDays * uChurnPerDay));
    // Small-scale albedo structure exists at every latitude. Only its
    // vertical relief fades into the shallow polar deck; fading the color
    // octave created a visibly low-resolution annulus around each cap.
    surface *= 1.0 + 0.14 * uContrast * micro * microGate;
    cloudH += mix(0.0, 0.05, zonalMicro) * uContrast * micro * microGate;
  }

  // Cloud tops are a relief surface: bump the shading normal with the
  // height's screen derivatives (mip-filtered, so this stays clean).
  vec3 normal = normalize(vWorldNormal);
  vec3 sx = dFdx(vWorldPos);
  vec3 sy = dFdy(vWorldPos);
  float hKm = cloudH * uCloudReliefKm;
  float slopeX = dFdx(hKm) / max(length(sx), 1e-5);
  float slopeY = dFdy(hKm) / max(length(sy), 1e-5);
  vec3 tx = normalize(sx - normal * dot(sx, normal) + vec3(1e-7));
  vec3 ty = normalize(sy - normal * dot(sy, normal) + vec3(1e-7));
  vec3 bumped = normalize(normal - clamp(slopeX, -0.6, 0.6) * tx - clamp(slopeY, -0.6, 0.6) * ty);

  float ndotl = dot(normal, uLightDir);
  float ndotl2 = dot(normal, uLight2Dir);
  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  float shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);

  // The deck is lit through the clear column above it and seen back
  // through the same column: the limb darkens as the slant lengthens,
  // and the column's own scattering veils the limb blue and rims the
  // lit edge — what the painted haze and rim once stood in for.
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, bumped, normal, shadow, diffuseShadow(shadow))
    + surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, bumped, normal, shadow2, diffuseShadow(shadow2));
  vec3 color = surface * (light + uNightFloor);
  float xv = airmass(dot(normal, viewDir));
  color = color * airColumnThrough(vec3(0.0), uOpticalDepth, xv)
    + uLightColor * airColumnScatter(vec3(0.0), uOpticalDepth, xv, airmass(ndotl), -dot(viewDir, uLightDir))
      * twilight(ndotl) * shadow
    + uLight2Color * airColumnScatter(vec3(0.0), uOpticalDepth, xv, airmass(ndotl2), -dot(viewDir, uLight2Dir))
      * twilight(ndotl2) * shadow2;

  // Hot giants radiate their own heat; the locked hotspot rides east
  // of the substellar point and carries into the night.
  if (uThermalStrength > 0.0) {
    float glow = uRegime > 0.5
      ? 0.25 + 0.75 * pow(clamp(dot(p, uHotspotDirObj), 0.0, 1.0), 3.0)
      : mix(0.35, 1.0, 1.0 - smoothstep(-0.1, 0.2, ndotl));
    color += uThermalColor * uThermalStrength * glow;
  }

  gl_FragColor = vec4(color * airTransmittanceTo(vWorldPos), 1.0);
}
`;

/** Samples the baked deck and adds everything view- and light-
 *  dependent: relief lighting, haze, thermal glow, eclipses. */
export function createGiantMaterial(
  physical: Characterization,
  circulation: Circulation,
): ShaderMaterial {
  const glowing = circulation.thermalGlowK > 700;
  const radiusKm = physical.bulk.radiusEarth * 6371;
  const { atmosphere, bulk } = physical;
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...airViewUniforms(),
      ...surfaceLightUniforms({
        ...deckOpticalDepth(atmosphere, bulk),
        horizon: horizonAirmass(radiusKm, atmosphere.scaleHeightKm),
        radius: radiusKm,
        scaleHeight: atmosphere.scaleHeightKm,
      }),
      uDeckA: { value: null },
      uDeckB: { value: null },
      uDeckMix: { value: 0 },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
      uTimeDays: { value: 0 },
      uContrast: { value: circulation.contrast },
      uChurnPerDay: { value: circulation.churnPerDay },
      uPolarCaps: {
        value: [circulation.polar.north.capStartRad, circulation.polar.south.capStartRad],
      },
      uCloudReliefKm: { value: physical.bulk.radiusEarth * 6371 * 0.008 },
      uRegime: { value: circulation.regime === 'locked' ? 1 : 0 },
      uHotspotDirObj: { value: new Vector3(0, 0, 1) },
      uThermalColor: {
        value: glowing ? blackbodyLinearRgb(circulation.thermalGlowK) : [0, 0, 0],
      },
      uThermalStrength: {
        value: glowing ? Math.min(1, (circulation.thermalGlowK / 1800) ** 4) : 0,
      },
    },
  });
}
