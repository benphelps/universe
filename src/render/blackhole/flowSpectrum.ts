import { DataTexture, FloatType, LinearFilter, NoColorSpace, RGBAFormat } from 'three';
import { planckRadiance } from '../../core/color/planck';
import { gamutMap, xyzToLinearSrgb } from '../../core/color/srgb';
import { spectrumToXyz } from '../../core/color/xyz';

export const FLOW_SPECTRUM_SIZE = 1024;
export const FLOW_LOG_T_MIN = Math.log2(500);
export const FLOW_LOG_T_MAX = Math.log2(1e9);

/** Thin-disk unit-luminance linear RGB plus log2 visible luminance. */
export function thermalVisibleSample(temperatureK: number): [number, number, number, number] {
  const xyz = spectrumToXyz(nm => planckRadiance(nm * 1e-9, temperatureK));
  const rgb = gamutMap(xyzToLinearSrgb(xyz));
  const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  return [rgb[0] / luminance, rgb[1] / luminance, rgb[2] / luminance, Math.log2(xyz.y)];
}

let samples: Float32Array | undefined;
export function flowSpectrumSamples(): Float32Array {
  return samples ??= Float32Array.from(Array.from({ length: FLOW_SPECTRUM_SIZE }, (_, i) =>
    thermalVisibleSample(2 ** (FLOW_LOG_T_MIN + i / (FLOW_SPECTRUM_SIZE - 1) * (FLOW_LOG_T_MAX - FLOW_LOG_T_MIN))),
  ).flat());
}

/** Log luminance avoids HDR overflow and retains faint, cool emission.
 * CPU integration is cached; each renderer owns its small GPU texture. */
export function createFlowSpectrum(): DataTexture {
  const texture = new DataTexture(flowSpectrumSamples(), FLOW_SPECTRUM_SIZE, 1, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export const FLOW_SPECTRUM_GLSL = /* glsl */ `
vec4 visibleSpectrum(float temperatureK) {
  float t = clamp((log2(max(temperatureK, 500.0)) - ${FLOW_LOG_T_MIN})
    / ${FLOW_LOG_T_MAX - FLOW_LOG_T_MIN}, 0.0, 1.0);
  // Coordinates address texel centres, including both endpoints.
  return texture2D(uLut, vec2((0.5 + t * ${FLOW_SPECTRUM_SIZE - 1}.0) / ${FLOW_SPECTRUM_SIZE}.0, 0.5));
}
vec3 flowLight(float tEmit, float g) {
  float tObs = tEmit * g;
  if (tObs < 500.0) return vec3(0.0);
  vec4 observed = visibleSpectrum(tObs);
  // I_nu/nu^3 invariance turns Planck(T) into Planck(gT). The received
  // visible band is integrated at gT; bolometric g^4 would count UV/X rays.
  // Carry linear visible radiance to the existing HDR output transform.
  // Compressing the radial profile here again washes out the outskirts.
  float logShown = observed.a - uRefLogVisible;
  return observed.rgb * exp2(clamp(logShown, -80.0, 30.0)) * uDiscGain;
}
`;
