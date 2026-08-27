import { Color, Vector3, Vector4 } from 'three';
import {
  MAX_ACTIVE_STORMS,
  MAX_BANDS,
  type Circulation,
} from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import { planetSeedOffset } from './solidPlanetMaterial';

/**
 * The deck pattern: cloud color and cloud-top height as a pure function
 * of direction and bake-time state. This runs in the cubemap baker, not
 * per frame — so it can afford every octave, and the sampler gets
 * hardware mipmaps instead of hand-tuned frequency gates.
 */
export const PATTERN_GLSL = /* glsl */ `
uniform vec3 uSeedOffset;
uniform float uTimeDays;
uniform int uBandCount;
uniform vec4 uBands[${MAX_BANDS}];      // latStart, latEnd, driftRadPerDay, edgeShear
uniform vec3 uBandColors[${MAX_BANDS}];
uniform float uBandFade[${MAX_BANDS}];
uniform int uStormCount;
uniform vec4 uStorms[${MAX_ACTIVE_STORMS}]; // lat, lon, size(<0 = eruption), age
uniform vec3 uStormFresh;
uniform vec3 uStormAged;
uniform vec4 uPolar;                    // capStart, ringCyclones, hexWave(signed), hemiDrift
uniform vec3 uHoodColor;
uniform float uContrast;
uniform float uFineBands;
uniform float uChurnPerDay;
uniform float uRegime;                  // 0 banded, 1 locked
uniform vec3 uLightDirObj;              // locked regime day-night frame

float wrapPi(float x) {
  return x - 6.2831853 * floor(x / 6.2831853 + 0.5);
}

float smooth01(float x) {
  float t = clamp(x, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

int bandAt(float lat) {
  int band = 0;
  for (int i = 0; i < ${MAX_BANDS}; i++) {
    if (i >= uBandCount) break;
    if (lat >= uBands[i].x) band = i;
  }
  return band;
}

/** One band's color with its fade cycle applied — fades feather along
 *  with the colors, so nothing steps at an edge. */
vec3 fadedBandColor(int i) {
  return mix(uBandColors[i], uStormFresh * 1.02, uBandFade[i]);
}

/** Band color at a (stirred) latitude, feathered across the edges so
 *  boundaries read as mixing fronts, not lines. Strong jets hold a
 *  crisp front; weak boundaries smear wide. */
vec3 bandColorAt(float l, int band) {
  vec3 c = fadedBandColor(band);
  if (band + 1 < uBandCount) {
    float feather = mix(0.045, 0.008, uBands[band + 1].w);
    float t = smoothstep(feather, 0.0, uBands[band + 1].x - l);
    c = mix(c, fadedBandColor(band + 1), 0.5 * t);
  }
  if (band > 0) {
    float feather = mix(0.045, 0.008, uBands[band].w);
    float t = smoothstep(feather, 0.0, l - uBands[band].x);
    c = mix(c, fadedBandColor(band - 1), 0.5 * t);
  }
  return c;
}

/** Continuous jet drift: each band advects its clouds, blended across
 *  the boundaries the same way the colors are — a discontinuous drift
 *  tears a visible seam at every edge as time advances. */
float bandDriftAt(float l, int band) {
  float d = uBands[band].z;
  if (band + 1 < uBandCount) {
    float t = smoothstep(0.04, 0.0, uBands[band + 1].x - l);
    d = mix(d, uBands[band + 1].z, 0.5 * t);
  }
  if (band > 0) {
    float t = smoothstep(0.04, 0.0, l - uBands[band].x);
    d = mix(d, uBands[band - 1].z, 0.5 * t);
  }
  return d;
}

/** The whole deck: linear color and cloud-top height for a direction. */
void deckAt(in vec3 p, out vec3 surface, out float cloudH) {
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, p.x);
  float churnT = uTimeDays * uChurnPerDay;

  if (uRegime < 0.5) {
    float hemi = sign(p.y + 1e-6);
    float capEdge = uPolar.x;
    bool hexHere = uPolar.z * hemi > 0.5;
    if (hexHere) {
      capEdge += 0.05 * cos(abs(uPolar.z) * lon * hemi + uTimeDays * uPolar.w);
    }
    // Zonal anisotropy and stirring belong to the jets: both fade into
    // the caps, where the turbulence is isotropic (as Juno found).
    float zonality = 1.0 - smoothstep(capEdge - 0.18, capEdge + 0.04, abs(lat));

    // The stir: multi-scale eddies displace the band lookup itself, so
    // belt material curls into the zones and boundaries are wakes.
    float edgeFactor = 0.0;
    for (int i = 1; i < ${MAX_BANDS}; i++) {
      if (i >= uBandCount) break;
      edgeFactor += uBands[i].w * exp(-pow((lat - uBands[i].x) / 0.09, 2.0));
    }
    edgeFactor = min(edgeFactor, 1.0);
    int band0 = bandAt(lat);
    float drift0 = bandDriftAt(lat, band0);
    float advLon0 = lon + uTimeDays * drift0;
    vec3 e = vec3(cos(lat) * cos(advLon0), sin(lat), cos(lat) * sin(advLon0));
    float amp = (0.35 + 0.65 * edgeFactor) * (0.35 + 0.65 * uContrast)
      * mix(0.3, 1.0, zonality);
    float w1 = snoise(vec3(e.x, e.y * 2.2, e.z) * 1.7 + uSeedOffset + vec3(0.0, 0.0, churnT * 0.3));
    float w2 = snoise(vec3(e.x, e.y * 3.4, e.z) * 4.4 - uSeedOffset.yzx + vec3(0.0, churnT * 0.6, 0.0));
    float w3 = snoise(vec3(e.x, e.y * 5.0, e.z) * 11.0 + uSeedOffset.zxy + vec3(churnT * 0.9, 0.0, 0.0));
    float warp = amp * (0.06 * w1 + 0.03 * w2 + 0.013 * w3);
    float wlat = clamp(lat + warp, -1.55, 1.55);
    int band = bandAt(wlat);
    vec3 bandColor = bandColorAt(wlat, band);
    cloudH = dot(bandColor, vec3(0.35, 0.45, 0.2));

    // The deck texture, advected with the local jet.
    float lonAdv = lon + uTimeDays * bandDriftAt(wlat, band);
    vec3 q = vec3(cos(wlat) * cos(lonAdv), sin(wlat), cos(wlat) * sin(lonAdv));
    float deck = fbm(vec3(q.x, q.y * mix(1.0, 4.0, zonality), q.z) * 3.0 + uSeedOffset
      + vec3(0.0, 0.0, churnT));
    float fine = fbm(vec3(q.x, q.y * mix(1.0, 7.0, zonality), q.z) * 9.0 + uSeedOffset.yzx
      + vec3(0.0, churnT * 1.6, 0.0));
    float micro = fbm(vec3(q.x, q.y * mix(1.0, 5.0, zonality), q.z) * 24.0 + uSeedOffset.zxy
      + vec3(churnT * 1.8, 0.0, 0.0));
    surface = bandColor * (1.0 + uContrast * (0.5 * deck + 0.28 * fine + 0.14 * micro));
    cloudH += uContrast * (0.2 * deck + 0.055 * fine + 0.03 * micro);

    if (uFineBands > 0.5) {
      float phase = 1.2 * snoise(vec3(q.x, q.z, wlat * 2.0) + uSeedOffset);
      surface *= 1.0 + 0.12 * uContrast * sin(wlat * uFineBands * 2.2 + phase);
    }

    // Storms: the catalog's live population, feathered into the deck —
    // no cutout edges, no separate grain.
    for (int i = 0; i < ${MAX_ACTIVE_STORMS}; i++) {
      if (i >= uStormCount) break;
      vec4 s = uStorms[i];
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
      float reach = smoothstep(5.0, 3.0, rr);
      float swirl = snoise(vec3(dLon, dLat, 0.4) * (5.0 / sz) + uSeedOffset.zxy
        + vec3(churnT * 0.5, 0.0, 0.0));
      float core = exp(-rr * 1.2);
      float rim = exp(-pow((sqrt(rr) - 1.0) * 3.2, 2.0));
      float sang = atan(dLat, dLon);
      float rn = sqrt(rr);
      float lanes = sin(rn * 6.5 - sang * 2.0 * sign(s.x + 1e-6) + swirl * 2.2 - churnT * 1.4);
      float fade = (s.z < 0.0 ? 1.0 - smooth01((s.w - 0.7) / 0.3) : 1.0) * reach;
      vec3 stormDeck = stormColor * (0.92 + 0.1 * swirl + 0.08 * lanes * core);
      surface = mix(surface, stormDeck, clamp(core * 1.25, 0.0, 1.0) * fade);
      surface = mix(surface, stormColor * 1.13, rim * 0.45 * fade);
      cloudH += core * fade * (s.z < 0.0 ? 0.5 : mix(0.55, 0.22, s.w));
      cloudH += 0.04 * lanes * core * fade;
    }

    // The polar regime: streaked cap, standing-wave lane, cyclones.
    float capSharp = hexHere ? 0.022 : 0.06;
    float cap = smoothstep(capEdge - capSharp, capEdge + capSharp, abs(wlat));
    if (hexHere) {
      float lane = exp(-pow((abs(wlat) - capEdge) / 0.014, 2.0));
      surface = mix(surface, uStormFresh * 1.08, lane * 0.4);
    }
    if (cap > 0.01) {
      float colat = 1.5707963 - abs(lat);
      // Differential rotation winds the deck into the polar spiral —
      // gently, saturating well before the pole (a solid-body eye),
      // structure only: sheared small eddies re-form, so the finer
      // octaves stay nearly isotropic.
      float windRad = hemi * (2.2 * smooth01((abs(lat) - capEdge + 0.25) / 1.1)
        + uTimeDays * uPolar.w * 2.0);
      vec3 ps = rotateY(p, windRad);
      vec3 psB = rotateY(p, windRad + 0.09 * hemi);
      vec3 psFine = rotateY(p, windRad * 0.3);
      float polarDeck = 0.5 * (fbm(ps * 5.0 + uSeedOffset.yxz + vec3(0.0, 0.0, churnT * 0.5))
        + fbm(psB * 5.0 + uSeedOffset.yxz + vec3(0.0, 0.0, churnT * 0.5)));
      float polarFine = fbm(psFine * 15.0 - uSeedOffset.zxy + vec3(churnT * 0.9, 0.0, 0.0));
      float polarMicro = fbm(psFine * 42.0 + uSeedOffset.xzy + vec3(0.0, churnT * 1.5, 0.0));
      vec3 hood = uHoodColor
        * (1.0 + uContrast * (0.4 * polarDeck + 0.24 * polarFine + 0.12 * polarMicro));
      surface = mix(surface, hood, cap * 0.6);
      cloudH = mix(cloudH, 0.5 + 0.2 * polarDeck + 0.05 * polarFine, cap * 0.65);

      vec2 pp = vec2(colat * cos(lon), colat * sin(lon));
      float dug = 0.0;
      float armsSum = 0.0;
      for (int i = 0; i < 10; i++) {
        if (float(i) > uPolar.y) break;
        vec2 c = vec2(0.0);
        float sizeInv = 1400.0;
        if (i > 0) {
          float a = 6.2831853 * float(i - 1) / max(uPolar.y, 1.0)
            + uTimeDays * uPolar.w * 1.7 * hemi;
          c = vec2(0.1 * cos(a), 0.1 * sin(a));
          sizeInv = 2400.0;
        }
        vec2 d = pp - c;
        float rr = dot(d, d) * sizeInv;
        if (rr > 7.0) continue;
        float w = hemi * (0.9 * exp(-rr * 0.5) + uTimeDays * (1.5 + 0.25 * float(i)));
        float cw = cos(w);
        float sw = sin(w);
        vec2 dw = vec2(cw * d.x - sw * d.y, sw * d.x + cw * d.y) * sqrt(sizeInv);
        float vn = fbm(vec3(dw * 1.4, float(i) * 3.7) + uSeedOffset.xzy);
        float core = exp(-rr * 0.8);
        dug += core;
        armsSum += core * (0.45 + 0.9 * vn);
      }
      dug = clamp(dug, 0.0, 1.0);
      surface *= mix(1.0, 0.5 + 0.7 * clamp(armsSum, 0.0, 1.2), dug * cap * 0.8);
      cloudH += -dug * cap * 0.25 + clamp(armsSum, 0.0, 1.0) * cap * 0.1;
    }
  } else {
    // Locked regime: day-night circulation, no bands. The star is
    // fixed in this frame, so the pattern bakes cleanly.
    float dayness = clamp(dot(p, uLightDirObj) * 0.9 + 0.35, 0.0, 1.0);
    float lonAdv = lon + uTimeDays * 2.4;
    vec3 q = vec3(cos(lat) * cos(lonAdv), sin(lat) * 3.5, cos(lat) * sin(lonAdv));
    float streaks = fbm(q * 2.6 + uSeedOffset + vec3(0.0, 0.0, churnT));
    surface = uBandColors[0] * (0.55 + 0.75 * dayness) * (1.0 + 0.4 * streaks);
    vec3 west = normalize(cross(vec3(0.0, 1.0, 0.0), uLightDirObj));
    float crescent = exp(-pow(dot(p, uLightDirObj) / 0.22, 2.0))
      * smoothstep(0.0, 0.5, dot(p, west));
    surface = mix(surface, uStormFresh, crescent * 0.55);
    cloudH = 0.5 + 0.3 * streaks + 0.4 * crescent;
  }
}
`;

/** Height is stored in the cube alpha at this scale. */
export const HEIGHT_SCALE = 0.5;

export function createPatternUniforms(
  physical: Characterization,
  circulation: Circulation,
): Record<string, { value: unknown }> {
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
  return {
    uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
    uTimeDays: { value: 0 },
    uBandCount: { value: Math.max(circulation.bands.length, 1) },
    uBands: { value: bands },
    uBandColors: { value: bandColors },
    uBandFade: { value: new Array(MAX_BANDS).fill(0) },
    uStormCount: { value: 0 },
    uStorms: { value: Array.from({ length: MAX_ACTIVE_STORMS }, () => new Vector4()) },
    uStormFresh: { value: new Color(...circulation.stormFresh) },
    uStormAged: { value: new Color(...circulation.stormAged) },
    uPolar: {
      value: new Vector4(
        circulation.polar.capStartRad,
        circulation.polar.cycloneCount - 1,
        circulation.polar.hexWave,
        0.12,
      ),
    },
    uHoodColor: { value: new Color(...circulation.polar.hoodColor) },
    uContrast: { value: circulation.contrast },
    uFineBands: { value: circulation.fineBandCount },
    uChurnPerDay: { value: circulation.churnPerDay },
    uRegime: { value: circulation.regime === 'locked' ? 1 : 0 },
    uLightDirObj: { value: new Vector3(0, 0, 1) },
  };
}
