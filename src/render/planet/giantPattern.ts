import { Color, Vector3, Vector4 } from 'three';
import {
  MAX_ACTIVE_STORMS,
  MAX_BANDS,
  type Circulation,
} from '../../universe/planet/circulation';
import type { Characterization } from '../../universe/planet/types';
import { planetSeedOffset } from './cloudPattern';

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
uniform vec4 uPolarNorth;               // capStart, ringCyclones, hexWave, clusterDrift
uniform vec4 uPolarSouth;
uniform vec4 uPolarScale;               // north ring/radius, south ring/radius
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

vec2 rotate2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

/** Map the regular tangent plane around either pole back onto the unit
 *  sphere. Unlike longitude alone, this remains well behaved at the
 *  pole and lets streamline taps converge without a pinched texture. */
vec3 polarSphere(vec2 q, float hemi) {
  float colat = length(q);
  vec2 radial = q / max(colat, 1e-5);
  float s = sin(colat);
  return vec3(s * radial.x, hemi * cos(colat), s * radial.y);
}

/** Local cloud motion: mostly cyclonic, with weak radial convergence.
 *  Smearing noise along this vector makes irregular spiral filaments,
 *  not concentric rings or embossed noise cells. */
vec2 polarStream(vec2 q, float hemi) {
  float r = max(length(q), 1e-5);
  vec2 radial = q / r;
  vec2 tangent = hemi * vec2(-radial.y, radial.x);
  vec2 flow = tangent - 0.2 * radial;
  return flow / max(length(flow), 1e-5);
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
  // The crisp end stays a few bake-texels wide, or a strong front
  // aliases into a dashed scratch.
  if (band + 1 < uBandCount) {
    float feather = mix(0.045, 0.016, uBands[band + 1].w);
    float t = smoothstep(feather, 0.0, uBands[band + 1].x - l);
    c = mix(c, fadedBandColor(band + 1), 0.5 * t);
  }
  if (band > 0) {
    float feather = mix(0.045, 0.016, uBands[band].w);
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

/** Multi-scale eddy displacement, sampled in one advection phase. */
float stirField(float lat, float advLon, vec3 seed, float churnT) {
  vec3 e = vec3(cos(lat) * cos(advLon), sin(lat), cos(lat) * sin(advLon));
  float w1 = snoise(vec3(e.x, e.y * 2.2, e.z) * 1.7 + seed + vec3(0.0, 0.0, churnT * 0.3));
  float w2 = snoise(vec3(e.x, e.y * 3.4, e.z) * 4.4 - seed.yzx + vec3(0.0, churnT * 0.6, 0.0));
  float w3 = snoise(vec3(e.x, e.y * 5.0, e.z) * 11.0 + seed.zxy + vec3(churnT * 0.9, 0.0, 0.0));
  return 0.06 * w1 + 0.03 * w2 + 0.013 * w3;
}

/** Streak-smeared deck (x) and fine (y) octaves in one advection phase:
 *  four taps down the local streamline, so streaks lengthen with the
 *  jet instead of scaling into parallel threads. */
vec2 streakDeck(float wlat, float lonAdv, float streakHalf, vec3 seed, float churnT) {
  float deck = 0.0;
  float fine = 0.0;
  for (int j = 0; j < 4; j++) {
    float lo = lonAdv + (float(j) - 1.5) * streakHalf * 0.667;
    vec3 qq = vec3(cos(wlat) * cos(lo), sin(wlat), cos(wlat) * sin(lo));
    deck += fbm(vec3(qq.x, qq.y * 2.0, qq.z) * 3.0 + seed + vec3(0.0, 0.0, churnT));
    fine += fbm(vec3(qq.x, qq.y * 2.5, qq.z) * 9.0 + seed.yzx + vec3(0.0, churnT * 1.6, 0.0));
  }
  return vec2(deck, fine) * 0.25;
}

/** The whole deck: linear color and cloud-top height for a direction. */
void deckAt(in vec3 p, out vec3 surface, out float cloudH) {
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, p.x);
  float churnT = uTimeDays * uChurnPerDay;

  if (uRegime < 0.5) {
    float hemi = sign(p.y + 1e-6);
    vec4 polar = hemi > 0.0 ? uPolarNorth : uPolarSouth;
    vec2 polarScale = hemi > 0.0 ? uPolarScale.xy : uPolarScale.zw;
    float capEdge = polar.x;
    bool hexHere = polar.z > 0.5;
    if (hexHere) {
      capEdge += 0.05 * cos(polar.z * lon * hemi + uTimeDays * polar.w);
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

    // Turbulence regenerates what the jets shear: advection runs on two
    // staggered bounded ages, each phase reseeded while weightless, so
    // a parcel drags at most half a cycle of differential shear before
    // fresh eddies replace it — otherwise the frozen noise grid shears
    // forever and tears into stitched arcs. Both ages advance at true
    // drift speed, so motion stays coherent through the crossfade; the
    // cycle divides the shader-time fold evenly, so weights stay
    // continuous across it.
    const float REGEN = 32.0;
    float fA = fract(uTimeDays / REGEN);
    float wA = 1.0 - abs(2.0 * fA - 1.0);
    float wB = 1.0 - wA;
    float ageA = (fA - 0.5) * REGEN;
    float ageB = (fract(fA + 0.5) - 0.5) * REGEN;
    vec3 seedA = uSeedOffset + vec3(7.31, 3.17, 5.71) * floor(uTimeDays / REGEN);
    vec3 seedB = uSeedOffset + vec3(3.71, 8.13, 2.97) * (floor(uTimeDays / REGEN + 0.5) + 31.0);
    // Independent phases average toward gray; renormalize so contrast
    // holds steady through the blend.
    float wNorm = inversesqrt(wA * wA + wB * wB);

    int band0 = bandAt(lat);
    float drift0 = bandDriftAt(lat, band0);
    float amp = (0.35 + 0.65 * edgeFactor) * (0.35 + 0.65 * uContrast)
      * mix(0.3, 1.0, zonality);
    float warp = amp * wNorm * (wA * stirField(lat, lon + ageA * drift0, seedA, churnT)
      + wB * stirField(lat, lon + ageB * drift0, seedB, churnT));
    float wlat = clamp(lat + warp, -1.55, 1.55);
    int band = bandAt(wlat);
    vec3 bandColor = bandColorAt(wlat, band);
    float bandMeanH = dot(bandColor, vec3(0.35, 0.45, 0.2));
    cloudH = bandMeanH;

    // Dragged gas, not stretched pixels: the texture is smeared along
    // the local streamline, so streaks lengthen with the jet, curve
    // where the stir bends the bands, and vary in width, instead of
    // parallel scaled-noise threads. The smear fades with the jets into
    // the isotropic caps.
    float driftHere = bandDriftAt(wlat, band);
    float streakHalf = zonality * (0.015 + 0.5 * abs(driftHere) + 0.06 * edgeFactor);
    float lonA = lon + ageA * driftHere;
    float lonB = lon + ageB * driftHere;
    vec2 df = wNorm * (wA * streakDeck(wlat, lonA, streakHalf, seedA, churnT)
      + wB * streakDeck(wlat, lonB, streakHalf, seedB, churnT));
    float deck = df.x;
    float fine = df.y;
    vec3 qA = vec3(cos(wlat) * cos(lonA), sin(wlat), cos(wlat) * sin(lonA));
    vec3 qB = vec3(cos(wlat) * cos(lonB), sin(wlat), cos(wlat) * sin(lonB));
    float micro = wNorm * (wA * fbm(vec3(qA.x, qA.y * 2.0, qA.z) * 24.0 + seedA.zxy
        + vec3(churnT * 1.8, 0.0, 0.0))
      + wB * fbm(vec3(qB.x, qB.y * 2.0, qB.z) * 24.0 + seedB.zxy
        + vec3(churnT * 1.8, 0.0, 0.0)));
    surface = bandColor * (1.0 + uContrast * (0.55 * deck + 0.32 * fine + 0.14 * micro));
    cloudH += uContrast * (0.22 * deck + 0.06 * fine + 0.03 * micro);

    if (uFineBands > 0.5) {
      // Fine banding belongs to the jets too: it fades into the caps
      // instead of ringing the pole like a record groove.
      float phase = 1.2 * wNorm * (wA * snoise(vec3(qA.x, qA.z, wlat * 2.0) + seedA)
        + wB * snoise(vec3(qB.x, qB.z, wlat * 2.0) + seedB));
      surface *= 1.0 + 0.12 * uContrast * zonality * sin(wlat * uFineBands * 2.2 + phase);
    }

    // Storms: perturb the same cloud field as the surrounding jet. Their
    // visible structure is primarily cloud opacity and composition; the
    // cloud-top displacement is shallow enough not to emboss an oval.
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
      vec2 local = vec2(dLon / max(sz * elong, 1e-4), dLat / max(sz * 0.66, 1e-4));
      float localR = length(local);
      if (localR > 2.7) continue;
      int stormBand = bandAt(s.x);
      float driftSign = sign(bandDriftAt(s.x, stormBand) + 1e-5);
      float fade = s.z < 0.0 ? 1.0 - smooth01((s.w - 0.7) / 0.3) : 1.0;
      if (s.z < 0.0) {
        // Convective outbreak: a bright head feeds a widening turbulent
        // wake that the jet stretches around the latitude band. It has no
        // oval rim and only the fresh head carries appreciable relief.
        float downstream = local.x * driftSign;
        float plumeNoise = snoise(vec3(downstream * 3.3, local.y * 6.5, float(i) * 4.1)
          + uSeedOffset.zxy + vec3(churnT * 0.45, 0.0, 0.0));
        float plumeFine = snoise(vec3(downstream * 7.2, local.y * 13.0, float(i) * 7.7)
          - uSeedOffset.yxz + vec3(0.0, churnT * 0.8, 0.0));
        float head = exp(-pow((downstream + 0.72) / 0.34, 2.0)
          - pow(local.y / 0.52, 2.0));
        float wakeWidth = 0.34 + 0.22 * s.w + 0.06 * plumeNoise;
        float trail = (1.0 - smoothstep(1.1, 2.45, abs(downstream)))
          * exp(-pow(local.y / max(wakeWidth, 0.18), 2.0));
        float plume = clamp(max(head, trail * (0.62 + 0.26 * plumeNoise + 0.12 * plumeFine)),
          0.0, 1.0);
        vec3 plumeColor = uStormFresh * (1.0 + 0.09 * plumeNoise + 0.04 * plumeFine);
        surface = mix(surface, plumeColor, plume * fade * 0.72);
        surface *= 1.0 + plume * fade * 0.08 * plumeFine;
        cloudH += fade * (0.04 * head + 0.01 * trail * max(plumeNoise, 0.0));
      } else {
        // Anticyclone: an organic elliptical envelope, wrapped internal
        // cloud lanes, a broken high-speed collar, and a downstream wake.
        // Broad warps keep none of these features geometrically perfect.
        float antiSense = -sign(s.x + 1e-6);
        vec2 localFlow = polarStream(local, antiSense);
        float broadWarp = snoise(vec3(local * 0.82, float(i) * 3.3)
          + uSeedOffset.zxy + vec3(0.0, 0.0, churnT * 0.14));
        float midWarp = snoise(vec3((local + localFlow * 0.25) * 1.9, float(i) * 5.1)
          - uSeedOffset.yxz + vec3(churnT * 0.25, 0.0, 0.0));
        float fine = snoise(vec3((local + localFlow * 0.12) * 4.2, float(i) * 7.9)
          + uSeedOffset.xzy + vec3(0.0, churnT * 0.42, 0.0));
        float organicR = localR * (1.0 + 0.11 * broadWarp + 0.045 * midWarp);
        float envelope = 1.0 - smoothstep(1.25, 2.35, organicR);
        float highCore = 1.0 - smoothstep(0.28, 1.08, organicR + 0.04 * broadWarp);
        float theta = atan(local.y, local.x);
        float spiralPhase = -2.0 * sign(s.x + 1e-6) * theta
          + 5.8 * log(organicR + 0.27)
          + 2.35 * broadWarp + 0.95 * midWarp - churnT * 0.22;
        float arm = sin(spiralPhase);
        float branch = sin(spiralPhase * 0.5 + 1.8 * organicR - 1.2 * midWarp);
        float filaments = 0.68 * arm + 0.2 * branch + 0.12 * fine;
        float collar = exp(-pow((organicR - 0.92) / 0.18, 2.0));
        float brokenCollar = collar * (0.58 + 0.42 * sin(spiralPhase + 1.4 * fine));

        // The jet parts around the anticyclone and leaves a churning wake
        // downstream, analogous to the region northwest of Jupiter's GRS.
        float wakeX = local.x * driftSign;
        float wake = smoothstep(0.42, 0.95, wakeX)
          * (1.0 - smoothstep(1.65, 2.55, wakeX))
          * exp(-pow(local.y / 0.62, 2.0));
        float wakeNoise = snoise(vec3(wakeX * 3.1, local.y * 7.0, float(i) * 9.1)
          - uSeedOffset.zyx + vec3(churnT * 0.55, 0.0, 0.0));

        // Chromophores and lofted condensates must separate the vortex
        // from whichever belt happens to contain it. Preserve the storm
        // hue, but enforce a modest local albedo separation when the
        // generated palette gives storm and belt nearly equal luminance.
        float deckLum = dot(surface, vec3(0.2126, 0.7152, 0.0722));
        float stormLum = dot(stormColor, vec3(0.2126, 0.7152, 0.0722));
        float lumDelta = stormLum - deckLum;
        float lumSense = lumDelta >= 0.0 ? 1.0 : -1.0;
        float targetLum = deckLum + lumSense * max(abs(lumDelta), 0.07 + 0.06 * uContrast);
        vec3 separatedStorm = stormColor * (targetLum / max(stormLum, 0.03));
        float tint = envelope * (0.28 + 0.36 * highCore) * fade;
        vec3 vortexCloud = separatedStorm * (0.98 + 0.07 * broadWarp + 0.035 * fine);
        surface = mix(surface, vortexCloud, tint);
        surface *= 1.0 + clamp(envelope * fade * (0.28 * filaments + 0.075 * brokenCollar)
          + wake * fade * 0.16 * wakeNoise, -0.27, 0.32);
        surface = mix(surface, uStormFresh * 1.06, brokenCollar * envelope * fade * 0.18);
        // A few kilometres of cloud-top structure, not the old giant
        // Gaussian dome that made every spot read as a bump.
        cloudH += fade * (0.012 * highCore + 0.005 * brokenCollar
          + 0.003 * envelope * filaments + 0.004 * wake * max(wakeNoise, 0.0));
      }
    }

    // The polar regime: streaked cap, standing-wave lane, cyclones.
    float capSharp = hexHere ? 0.022 : 0.06;
    float capCore = smoothstep(capEdge - capSharp, capEdge + capSharp, abs(wlat));
    // Begin the polar texture exactly where zonal anisotropy begins to
    // fade. Keeping a separate core mask preserves a crisp physical cap
    // boundary while avoiding a low-frequency no-man's-land between the
    // detailed jets and detailed polar circulation.
    float capBlend = 1.0 - zonality;
    if (hexHere) {
      float lane = exp(-pow((abs(wlat) - capEdge) / 0.014, 2.0));
      surface = mix(surface, uStormFresh * 1.08, lane * 0.4);
    }
    if (capBlend > 0.01) {
      float colat = 1.5707963 - abs(lat);
      vec2 pp = vec2(colat * cos(lon), colat * sin(lon));
      // Advect the whole cap, then build its cloud streets in polar
      // coordinates. The spiral phase is the large-scale signal; noise
      // only bends and frays it. Previously the original FBM remained
      // the dominant layer, so the new flow was mathematically present
      // but the pole still looked like the same cellular orange peel.
      float capSpin = hemi * (1.1 * smooth01((abs(lat) - capEdge + 0.24) / 0.95)
        + uTimeDays * polar.w);
      vec2 adv = rotate2(pp, capSpin);
      vec2 flow = polarStream(adv, hemi);
      float capTheta = atan(adv.y, adv.x);
      float capWarp = snoise(vec3(adv * 5.5, hemi * 2.7) + uSeedOffset.yzx
        + vec3(0.0, 0.0, churnT * 0.18));
      float capFray = snoise(vec3((adv + flow * 0.035) * 14.0, hemi * 5.1)
        - uSeedOffset.zxy + vec3(churnT * 0.32, 0.0, 0.0));
      float capPhase = 3.0 * hemi * capTheta + 18.0 * colat
        + 2.4 * capWarp + 0.65 * capFray;
      float capSpiral = sin(capPhase);
      float capBranch = sin(2.0 * hemi * capTheta - 11.0 * colat
        - 1.7 * capWarp + 0.8 * capFray);
      float polarDeck = 0.62 * capSpiral + 0.24 * capBranch + 0.14 * capFray;
      // One cloud field spans the whole sphere. The cap changes its mean
      // color and superposes polar circulation, but never replaces or
      // fades the underlying detail; consequently there is no latitude
      // at which the texture loses resolution. Small-scale turbulence is
      // isotropic here because streakHalf has already relaxed to zero.
      vec3 hoodRatio = uHoodColor / max(bandColor, vec3(0.04));
      surface *= mix(vec3(1.0), hoodRatio, capBlend);
      surface *= 1.0 + capBlend * uContrast * 0.24 * polarDeck;
      surface = max(surface, vec3(0.0));
      // Albedo detail remains continuous, while high-frequency vertical
      // relief relaxes into the shallow polar deck. Decoupling those two
      // quantities removes orange-peel lighting without blurring clouds.
      float baseRelief = cloudH - bandMeanH;
      float reliefCarry = mix(1.0, 0.08, capBlend);
      cloudH = mix(bandMeanH, 0.5, capBlend)
        + baseRelief * reliefCarry
        + capBlend * 0.012 * polarDeck;

      for (int i = 0; i < 10; i++) {
        if (float(i) > polar.y) break;
        vec2 c = vec2(0.0);
        float vortexRadius = polarScale.y * 1.65;
        if (i > 0) {
          float a = 6.2831853 * float(i - 1) / max(polar.y, 1.0)
            + uTimeDays * polar.w * hemi;
          c = polarScale.x * vec2(cos(a), sin(a));
          vortexRadius = polarScale.y * 1.48;
        } else if (polar.y < 0.5) {
          // Saturn-style poles are one broad classical vortex, not the
          // same small central dot with its companions deleted.
          vortexRadius = max(polarScale.x * 1.05, polarScale.y * 2.6);
        }
        vec2 d = pp - c;
        float rr = dot(d, d) / max(vortexRadius * vortexRadius, 1e-6);
        if (rr > 9.0) continue;
        float phase = hemi * (float(i) * 2.399
          + uTimeDays * (1.05 + 0.11 * float(i)));
        vec2 local = rotate2(d / vortexRadius, phase);
        float localR = length(local);
        vec2 localFlow = polarStream(local, hemi);
        float broadWarp = snoise(vec3(local * 0.72, float(i) * 3.7)
          + uSeedOffset.xzy + vec3(0.0, 0.0, churnT * 0.12));
        float midWarp = snoise(vec3((local + localFlow * 0.28) * 1.65, float(i) * 5.9)
          - uSeedOffset.zyx + vec3(churnT * 0.22, 0.0, 0.0));
        float fine = snoise(vec3((local + localFlow * 0.16) * 3.8, float(i) * 7.1)
          + uSeedOffset.yxz + vec3(0.0, churnT * 0.36, 0.0));
        float organicR = localR * (1.0 + 0.1 * broadWarp + 0.045 * midWarp);
        float envelope = 1.0 - smoothstep(1.45, 2.75, organicR);
        float eye = 1.0 - smoothstep(0.1, 0.28, organicR + 0.04 * midWarp);
        float eyewall = exp(-pow((organicR - 0.43) / 0.16, 2.0));
        float shield = exp(-pow((organicR - 1.72) / 0.3, 2.0));
        // The logarithmic phase supplies a genuinely coherent two-arm
        // cyclone. Low-frequency domain warps split and reconnect the
        // arms; the fine octave only frays their cloud edges.
        float vortexTheta = atan(local.y, local.x);
        float spiralPhase = 2.0 * hemi * vortexTheta
          + 6.8 * log(organicR + 0.24)
          + 2.5 * broadWarp + 1.1 * midWarp + float(i) * 1.37;
        float arm = sin(spiralPhase);
        float branch = sin(spiralPhase * 0.5 + 2.0 * organicR - 1.4 * midWarp);
        float filaments = 0.68 * arm + 0.2 * branch + 0.12 * fine;
        float lane = envelope * (1.0 - eye) * smoothstep(-0.3, 0.58, arm + 0.32 * fine);
        float brokenWall = eyewall * (0.55 + 0.45 * sin(spiralPhase + 1.3 * midWarp));
        float vortexSignal = envelope * (0.46 * filaments + 0.05 * brokenWall + 0.12 * lane)
          - 0.025 * shield - 0.07 * eye;
        vec3 vortexColor = mix(uHoodColor, uStormFresh, 0.34)
          * (1.0 + clamp(vortexSignal, -0.32, 0.38));
        // Vortices replace the background locally instead of being a
        // faint decal over it. This makes the circulation readable at
        // the same distance where the old noise cells were visible.
        surface = mix(surface, vortexColor, capCore * envelope * 0.9);
        surface = mix(surface, uHoodColor * 0.76, capCore * eye * 0.3);
        // Do not excavate the eye in the height field: a dark cloud-free
        // center is not a crater in the 1-bar surface.
        cloudH = mix(cloudH, 0.5 + 0.008 * filaments + 0.004 * brokenWall,
          capCore * envelope * 0.75);
      }
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
    uPolarNorth: {
      value: new Vector4(
        circulation.polar.north.capStartRad,
        circulation.polar.north.cycloneCount - 1,
        circulation.polar.north.hexWave,
        circulation.polar.north.driftRadPerDay,
      ),
    },
    uPolarSouth: {
      value: new Vector4(
        circulation.polar.south.capStartRad,
        circulation.polar.south.cycloneCount - 1,
        circulation.polar.south.hexWave,
        circulation.polar.south.driftRadPerDay,
      ),
    },
    uPolarScale: {
      value: new Vector4(
        circulation.polar.north.ringRadiusRad,
        circulation.polar.north.cycloneRadiusRad,
        circulation.polar.south.ringRadiusRad,
        circulation.polar.south.cycloneRadiusRad,
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
