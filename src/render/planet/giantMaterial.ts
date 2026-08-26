import { Color, ShaderMaterial, Vector3, Vector4 } from 'three';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import {
  MAX_ACTIVE_STORMS,
  MAX_BANDS,
  type Circulation,
} from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { secondSunUniforms } from '../lighting/secondSun';
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
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uSeedOffset;
uniform float uTimeDays;

uniform int uBandCount;
uniform vec4 uBands[${MAX_BANDS}];      // latStart, latEnd, driftRadPerDay, edgeShear
uniform vec3 uBandColors[${MAX_BANDS}];
uniform int uStormCount;
uniform vec4 uStorms[${MAX_ACTIVE_STORMS}]; // lat, lon, size, age
uniform vec3 uStormFresh;
uniform vec3 uStormAged;
uniform float uBandFade[${MAX_BANDS}];
uniform vec4 uPolar;                    // capStart, cycloneCount, hexWave, hemiDrift
uniform vec3 uHoodColor;
uniform vec4 uAurora;                   // strength, tiltRad, azimuthRad, ovalColat
uniform float uContrast;
uniform float uFineBands;
uniform float uChurnPerDay;
uniform float uRegime;                  // 0 banded, 1 locked
uniform vec3 uLightDirObj;
uniform vec3 uHotspotDirObj;
uniform vec3 uThermalColor;
uniform float uThermalStrength;
uniform float uCloudReliefKm;
uniform float uHazeAmount;

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}

float wrapPi(float x) {
  return x - 6.2831853 * floor(x / 6.2831853 + 0.5);
}

float smooth01(float x) {
  float t = clamp(x, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

int bandAt(float lat) {
  int band = 0;
  for (int i = 0; i < ${MAX_BANDS}; i++) {
    if (i >= uBandCount) break;
    if (lat >= uBands[i].x) band = i;
  }
  return band;
}

/** Band color at a (stirred) latitude, feathered across the edges so
 *  boundaries read as mixing fronts, not lines. */
vec3 bandColorAt(float l, int band) {
  vec3 c = uBandColors[band];
  // Strong jets hold a crisp front; weak boundaries smear wide.
  if (band + 1 < uBandCount) {
    float feather = mix(0.045, 0.008, uBands[band + 1].w);
    float t = smoothstep(feather, 0.0, uBands[band + 1].x - l);
    c = mix(c, uBandColors[band + 1], 0.5 * t);
  }
  if (band > 0) {
    float feather = mix(0.045, 0.008, uBands[band].w);
    float t = smoothstep(feather, 0.0, l - uBands[band].x);
    c = mix(c, uBandColors[band - 1], 0.5 * t);
  }
  return c;
}

void main() {
  vec3 p = normalize(vObjPos);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, p.x);
  float churnT = uTimeDays * uChurnPerDay;
  vec3 surface;
  float cloudHOut = 0.5;

  if (uRegime < 0.5) {
    // ——— Banded regime: the circulation model, rendered. ———
    // The deck is a tracer stirred by the same eddies that drive the
    // jets: a multi-scale displacement field moves the band lookup
    // itself, so belt material curls deep into the zones, band widths
    // wander with longitude, and the boundaries are wakes, not lines.
    // The stirring rides everywhere and doubles where the model says
    // the shear is.
    float edgeFactor = 0.0;
    for (int i = 1; i < ${MAX_BANDS}; i++) {
      if (i >= uBandCount) break;
      edgeFactor += uBands[i].w * exp(-pow((lat - uBands[i].x) / 0.09, 2.0));
    }
    edgeFactor = min(edgeFactor, 1.0);
    int band0 = bandAt(lat);
    float advLon = lon + uTimeDays * uBands[band0].z;
    vec3 e = vec3(cos(lat) * cos(advLon), sin(lat), cos(lat) * sin(advLon));
    float amp = (0.35 + 0.65 * edgeFactor) * (0.35 + 0.65 * uContrast);
    float w1 = snoise(vec3(e.x, e.y * 2.2, e.z) * 1.7 + uSeedOffset + vec3(0.0, 0.0, churnT * 0.3));
    float w2 = snoise(vec3(e.x, e.y * 3.4, e.z) * 4.4 - uSeedOffset.yzx + vec3(0.0, churnT * 0.6, 0.0));
    float w3 = snoise(vec3(e.x, e.y * 5.0, e.z) * 11.0 + uSeedOffset.zxy + vec3(churnT * 0.9, 0.0, 0.0));
    float warp = amp * (0.06 * w1 + 0.03 * w2 + 0.013 * w3);
    float wlat = lat + warp;
    int band = bandAt(wlat);
    vec3 bandColor = bandColorAt(wlat, band);
    // Decadal fade cycles: fresh white deck buries a belt's color,
    // then the revival scours it away (the SEB's habit).
    bandColor = mix(bandColor, uStormFresh * 1.02, uBandFade[band]);
    // Cloud-top height rides with brightness: high fresh ammonia decks
    // are the bright ones, dark belts are the deep holes. Fades,
    // feathering, and stirring all inherit through the color.
    float cloudH = dot(bandColor, vec3(0.35, 0.45, 0.2));

    // The deck: churned cloud texture advected with the band's own jet.
    float lonAdv = lon + uTimeDays * uBands[band].z;
    vec3 q = vec3(cos(wlat) * cos(lonAdv), sin(wlat), cos(wlat) * sin(lonAdv));
    float deck = fbm(vec3(q.x, q.y * 4.0, q.z) * 3.0 + uSeedOffset + vec3(0.0, 0.0, churnT));
    float fine = fbm(vec3(q.x, q.y * 7.0, q.z) * 9.0 + uSeedOffset.yzx
      + vec3(0.0, churnT * 1.6, 0.0));
    surface = bandColor * (1.0 + uContrast * (0.5 * deck + 0.28 * fine));
    cloudH += uContrast * (0.2 * deck + 0.055 * fine);

    // The physics often asks for more bands than the macro budget
    // carries: the surplus renders as faint striping within them.
    if (uFineBands > 0.5) {
      float phase = 1.2 * snoise(vec3(q.x, q.z, wlat * 2.0) + uSeedOffset);
      surface *= 1.0 + 0.12 * uContrast * sin(wlat * uFineBands * 2.2 + phase);
    }

    // Storms: the catalog's live population, ovals with rims, carved
    // into their bands.
    for (int i = 0; i < ${MAX_ACTIVE_STORMS}; i++) {
      if (i >= uStormCount) break;
      vec4 s = uStorms[i];
      // Negative size flags an eruption: a fresh white head smeared
      // down its band by the jet until it circles the planet.
      float sz = abs(s.z);
      float elong = 1.3;
      vec3 stormColor;
      if (s.z < 0.0) {
        elong = mix(1.5, 45.0, s.w * s.w);
        stormColor = uStormFresh * 1.08;
      } else {
        stormColor = mix(uStormFresh, uStormAged, s.w);
      }
      float dLat = lat - s.x;
      float dLon = wrapPi(lon - s.y) * cos(s.x);
      float rr = (dLat * dLat) / (sz * sz * 0.42) + (dLon * dLon) / (sz * sz * elong * elong);
      if (rr > 5.0) continue;
      float swirl = snoise(vec3(dLon, dLat, 0.4) * (5.0 / sz) + uSeedOffset.zxy
        + vec3(churnT * 0.5, 0.0, 0.0));
      float core = exp(-rr * 1.2);
      float rim = exp(-pow((sqrt(rr) - 1.0) * 3.2, 2.0));
      float fade = s.z < 0.0 ? 1.0 - smooth01((s.w - 0.7) / 0.3) : 1.0;
      surface = mix(surface, stormColor * (0.94 + 0.12 * swirl), clamp(core * 1.25, 0.0, 1.0) * fade);
      surface = mix(surface, stormColor * 1.13, rim * 0.45 * fade);
      // Storm heads tower above the deck, fresh ones highest.
      cloudH += core * fade * (s.z < 0.0 ? 0.55 : mix(0.6, 0.25, s.w));
    }

    // The polar regime: hood, hexagon-analog cap edge, cyclone cluster.
    float hemi = sign(p.y + 1e-6);
    float capEdge = uPolar.x;
    if (uPolar.z > 0.5) {
      capEdge += 0.03 * cos(uPolar.z * lon * hemi + uTimeDays * uPolar.w);
    }
    float cap = smoothstep(capEdge - 0.06, capEdge + 0.06, abs(wlat));
    surface = mix(surface, uHoodColor * (0.92 + 0.16 * fbm(p * 5.0 + uSeedOffset)), cap * 0.85);
    cloudH = mix(cloudH, 0.55, cap * 0.7);
    if (cap > 0.01) {
      float colat = 1.5707963 - abs(lat);
      vec2 pp = vec2(colat * cos(lon), colat * sin(lon));
      float vortices = exp(-dot(pp, pp) / 0.0018);
      for (int i = 0; i < 9; i++) {
        if (float(i) >= uPolar.y) break;
        float a = 6.2831853 * float(i) / uPolar.y + uTimeDays * uPolar.w * 1.7 * hemi;
        vec2 c = vec2(0.13 * cos(a), 0.13 * sin(a));
        vortices += exp(-dot(pp - c, pp - c) / 0.0022);
      }
      surface = mix(surface, uHoodColor * 0.68, clamp(vortices, 0.0, 1.0) * cap * 0.85);
      cloudHOut = cloudH - clamp(vortices, 0.0, 1.0) * cap * 0.3;
    } else {
      cloudHOut = cloudH;
    }
  } else {
    // ——— Locked regime: day-night circulation, no bands. ———
    float dayness = clamp(dot(p, uLightDirObj) * 0.9 + 0.35, 0.0, 1.0);
    // Superrotating streaks smear the deck zonally past the terminator.
    float lonAdv = lon + uTimeDays * 2.4;
    vec3 q = vec3(cos(lat) * cos(lonAdv), sin(lat) * 3.5, cos(lat) * sin(lonAdv));
    float streaks = fbm(q * 2.6 + uSeedOffset + vec3(0.0, 0.0, churnT));
    surface = uBandColors[0] * (0.55 + 0.75 * dayness) * (1.0 + 0.4 * streaks);
    // Condensate clouds ride the cooler west terminator.
    vec3 west = normalize(cross(vec3(0.0, 1.0, 0.0), uLightDirObj));
    float crescent = exp(-pow(dot(p, uLightDirObj) / 0.22, 2.0))
      * smoothstep(0.0, 0.5, dot(p, west));
    surface = mix(surface, uStormFresh, crescent * 0.55);
    cloudHOut = 0.5 + 0.3 * streaks + 0.4 * crescent;
  }

  // Lighting: the cloud tops are a relief surface, not a shell. The
  // height field bumps the shading normal via screen derivatives, so
  // low sun rakes across zone edges and storm heads exactly where a
  // terminator crosses them (relief exaggerated ~8× actual cloud-deck
  // scale so it reads at planetary distance — disclosed).
  vec3 normal = normalize(vWorldNormal);
  vec3 sx = dFdx(vWorldPos);
  vec3 sy = dFdy(vWorldPos);
  float hKm = cloudHOut * uCloudReliefKm;
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

  // The high haze layer: a thin veil with its own slow drift, nearly
  // clear overhead and thickening toward the limb with the slant
  // path — the deck visibly sits below it.
  if (uHazeAmount > 0.01) {
    float hazeLon = lon + uTimeDays * 0.35;
    vec3 hp = vec3(cos(lat) * cos(hazeLon), sin(lat) * 1.6, cos(lat) * sin(hazeLon));
    float hazeN = fbm(hp * 1.9 + uSeedOffset.zyx + vec3(0.0, 0.0, churnT * 0.15));
    float slant = 1.0 - mu * 0.85;
    float cover = uHazeAmount * clamp(0.35 + 0.65 * hazeN, 0.0, 1.0) * slant * slant;
    surface = mix(surface, uStormFresh * 1.04, clamp(cover, 0.0, 0.85));
    diffuse = mix(diffuse, max(ndotl, 0.0), clamp(cover, 0.0, 0.85));
  }

  float diffuse2 = max(dot(bumped, uLight2Dir), 0.0) * shadowFactor(vWorldPos, uLight2Dir);
  vec3 color = surface * (uLightColor * (diffuse + 0.004) + uLight2Color * diffuse2) * limb;

  // Stratospheric haze: a forward-scattering bright rim on the lit limb.
  float rimGlow = pow(1.0 - mu, 4.0);
  color += uLightColor * uBandColors[0] * rimGlow * (0.1 + 0.5 * max(ndotl, 0.0));

  // Hot giants radiate their own heat; the locked hotspot rides east
  // of the substellar point and carries into the night.
  if (uThermalStrength > 0.0) {
    float glow = uRegime > 0.5
      ? 0.25 + 0.75 * pow(clamp(dot(p, uHotspotDirObj), 0.0, 1.0), 3.0)
      : mix(0.35, 1.0, 1.0 - smoothstep(-0.1, 0.2, ndotl));
    color += uThermalColor * uThermalStrength * glow * limb;
  }

  if (uAurora.x > 0.0) {
    vec3 mAxis = vec3(
      sin(uAurora.y) * cos(uAurora.z),
      cos(uAurora.y),
      sin(uAurora.y) * sin(uAurora.z)
    );
    float mColat = acos(clamp(abs(dot(p, mAxis)), 0.0, 1.0));
    float oval = exp(-pow((mColat - uAurora.w) / 0.05, 2.0));
    float night = 1.0 - smoothstep(-0.05, 0.25, ndotl);
    float curtain = 0.55 + 0.45 * snoise(vec3(p.x, p.z, uTimeDays * 0.6) * 9.0 + uSeedOffset);
    color += vec3(0.5, 0.32, 0.85) * oval * uAurora.x * (0.03 + 0.6 * night) * curtain;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

/** The circulation model's renderer: bands, storms, poles, aurora, and
 *  regimes all arrive as uniforms from first-class derived objects. */
export function createGiantMaterial(
  physical: Characterization,
  circulation: Circulation,
): ShaderMaterial {
  const bands: Vector4[] = [];
  const bandColors: Color[] = [];
  for (let i = 0; i < MAX_BANDS; i++) {
    const band = circulation.bands[Math.min(i, circulation.bands.length - 1)];
    bands.push(
      band
        ? new Vector4(band.latStartRad, band.latEndRad, band.driftRadPerDay, band.edgeShear)
        : new Vector4(0, 0, 0, 0),
    );
    bandColors.push(band ? new Color(...band.color) : new Color(0.5, 0.5, 0.5));
  }
  const glowing = circulation.thermalGlowK > 700;
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
      uTimeDays: { value: 0 },
      uBandCount: { value: Math.max(circulation.bands.length, 1) },
      uBands: { value: bands },
      uBandColors: { value: bandColors },
      uStormCount: { value: 0 },
      uStorms: {
        value: Array.from({ length: MAX_ACTIVE_STORMS }, () => new Vector4()),
      },
      uBandFade: { value: new Array(MAX_BANDS).fill(0) },
      uStormFresh: { value: new Color(...circulation.stormFresh) },
      uStormAged: { value: new Color(...circulation.stormAged) },
      uPolar: {
        value: new Vector4(
          circulation.polar.capStartRad,
          circulation.polar.cycloneCount,
          circulation.polar.hexWave,
          0.12,
        ),
      },
      uHoodColor: { value: new Color(...circulation.polar.hoodColor) },
      uAurora: {
        value: new Vector4(
          circulation.auroraStrength,
          circulation.auroraTiltRad,
          circulation.auroraAzimuthRad,
          0.3,
        ),
      },
      uContrast: { value: circulation.contrast },
      uCloudReliefKm: { value: physical.bulk.radiusEarth * 6371 * 0.008 },
      uHazeAmount: { value: 0.12 + 0.4 * (1 - circulation.contrast) },
      uFineBands: { value: circulation.fineBandCount },
      uChurnPerDay: { value: circulation.churnPerDay },
      uRegime: { value: circulation.regime === 'locked' ? 1 : 0 },
      uLightDirObj: { value: new Vector3(0, 0, 1) },
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
