import { Color, ShaderMaterial, Vector3, Vector4 } from 'three';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import { type Circulation } from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { secondSunUniforms } from '../lighting/secondSun';
import { HEIGHT_SCALE } from './giantPattern';
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
uniform float uCloudReliefKm;
uniform float uHazeAmount;
uniform vec3 uHazeColor;
uniform vec3 uRimColor;
uniform vec4 uAurora;                   // strength, tiltRad, azimuthRad, ovalColat
uniform float uRegime;                  // 0 banded, 1 locked
uniform vec3 uHotspotDirObj;
uniform vec3 uThermalColor;
uniform float uThermalStrength;

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}

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
    float micro = fbm(vec3(p.x, p.y * 2.5, p.z) * 30.0 + uSeedOffset
      + vec3(0.0, 0.0, uTimeDays * uChurnPerDay));
    surface *= 1.0 + 0.15 * uContrast * micro * microGate;
    cloudH += 0.05 * uContrast * micro * microGate;
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
  float diffuse = max(dot(bumped, uLightDir), 0.0) * shadowFactor(vWorldPos, uLightDir);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float mu = clamp(dot(normal, viewDir), 0.0, 1.0);
  float limb = 1.0 - 0.45 * (1.0 - mu);

  // The high haze veil: nearly clear overhead, thickening with the
  // slant path toward the limb, drifting on its own.
  if (uHazeAmount > 0.01) {
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float hazeLon = atan(p.z, p.x) + uTimeDays * 0.35;
    vec3 hp = vec3(cos(lat) * cos(hazeLon), sin(lat) * 1.6, cos(lat) * sin(hazeLon));
    float hazeN = fbm(hp * 1.9 + uSeedOffset.zyx + vec3(0.0, 0.0, uTimeDays * uChurnPerDay * 0.15));
    float slant = 1.0 - mu * 0.85;
    float cover = uHazeAmount * clamp(0.35 + 0.65 * hazeN, 0.0, 1.0) * slant * slant;
    surface = mix(surface, uHazeColor, clamp(cover, 0.0, 0.85));
    diffuse = mix(diffuse, max(ndotl, 0.0), clamp(cover, 0.0, 0.85));
  }

  float diffuse2 = max(dot(bumped, uLight2Dir), 0.0) * shadowFactor(vWorldPos, uLight2Dir);
  vec3 color = surface * (uLightColor * (diffuse + 0.004) + uLight2Color * diffuse2) * limb;

  // Stratospheric haze: a forward-scattering bright rim on the lit limb.
  float rimGlow = pow(1.0 - mu, 4.0);
  color += uLightColor * uRimColor * rimGlow * (0.1 + 0.5 * max(ndotl, 0.0));

  // Hot giants radiate their own heat; the locked hotspot rides east
  // of the substellar point and carries into the night.
  if (uThermalStrength > 0.0) {
    float glow = uRegime > 0.5
      ? 0.25 + 0.75 * pow(clamp(dot(p, uHotspotDirObj), 0.0, 1.0), 3.0)
      : mix(0.35, 1.0, 1.0 - smoothstep(-0.1, 0.2, ndotl));
    color += uThermalColor * uThermalStrength * glow * limb;
  }

  // Aurora: magnetic-frame curtains — a thin rayed core in a faint
  // glow, flickering along the oval, sharpening on approach.
  if (uAurora.x > 0.0) {
    vec3 mAxis = vec3(
      sin(uAurora.y) * cos(uAurora.z),
      cos(uAurora.y),
      sin(uAurora.y) * sin(uAurora.z)
    );
    vec3 m1 = normalize(cross(mAxis, vec3(0.0, 0.0, 1.0)));
    vec3 m2 = cross(mAxis, m1);
    float mDot = dot(p, mAxis);
    float mColat = acos(clamp(abs(mDot), 0.0, 1.0));
    float mLon = atan(dot(p, m2), dot(p, m1)) * sign(mDot + 1e-6);
    float core = exp(-pow((mColat - uAurora.w) / 0.022, 2.0));
    float glow = 0.3 * exp(-pow((mColat - uAurora.w) / 0.09, 2.0));
    float rays = 0.4
      + 0.6 * pow(0.5 + 0.5 * snoise(vec3(cos(mLon), sin(mLon), mColat * 4.0) * 11.0
          + uSeedOffset + vec3(0.0, 0.0, uTimeDays * 1.7)), 2.0);
    rays *= 0.55 + 0.45 * snoise(vec3(cos(mLon), sin(mLon), 2.6) * 33.0
      - uSeedOffset.yzx + vec3(uTimeDays * 2.3, 0.0, 0.0));
    if (microGate > 0.01) {
      rays *= 1.0 + 0.5 * microGate
        * snoise(vec3(cos(mLon), sin(mLon), mColat * 9.0) * 90.0 + uSeedOffset.zxy
            + vec3(0.0, uTimeDays * 3.1, 0.0));
    }
    float night = 1.0 - smoothstep(-0.05, 0.25, ndotl);
    color += vec3(0.5, 0.32, 0.85) * (core * rays + glow * (0.5 + 0.5 * rays))
      * uAurora.x * (0.05 + 0.75 * night);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

/** Samples the baked deck and adds everything view- and light-
 *  dependent: relief lighting, haze, thermal glow, aurora, eclipses. */
export function createGiantMaterial(
  physical: Characterization,
  circulation: Circulation,
): ShaderMaterial {
  const glowing = circulation.thermalGlowK > 700;
  const rim = circulation.bands[Math.floor(circulation.bands.length / 2)]?.color ?? [
    0.6, 0.6, 0.6,
  ];
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
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
      uCloudReliefKm: { value: physical.bulk.radiusEarth * 6371 * 0.008 },
      uHazeAmount: { value: 0.12 + 0.4 * (1 - circulation.contrast) },
      uHazeColor: { value: new Color(...circulation.stormFresh).multiplyScalar(1.04) },
      uRimColor: { value: new Color(...rim) },
      uAurora: {
        value: new Vector4(
          circulation.auroraStrength,
          circulation.auroraTiltRad,
          circulation.auroraAzimuthRad,
          0.3,
        ),
      },
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
