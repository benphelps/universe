import { DataTexture, FloatType, LinearFilter, RGBAFormat, type ShaderMaterial } from 'three';
import { blackbodySurfaceEmission } from './thermalEmission';

export const THERMAL_LUT_SIZE = 512;
export const THERMAL_MIN_K = 400;
export const THERMAL_MAX_K = 50000;
const LOG_MIN = Math.log(THERMAL_MIN_K), LOG_SPAN = Math.log(THERMAL_MAX_K / THERMAL_MIN_K);
let samples: Float32Array | undefined;

/** Shared immutable CPU samples; each material owns its tiny GPU texture.
 * Log power follows the Wien tail; interpolated hue retains black channels
 * at gamut boundaries. No spectral integrals or uploads in the frame loop. */
export function thermalLutSamples(): Float32Array {
  if (!samples) {
    samples = new Float32Array(THERMAL_LUT_SIZE * 4);
    for (let i = 0; i < THERMAL_LUT_SIZE; i++) {
      const emission = blackbodySurfaceEmission(Math.exp(LOG_MIN + LOG_SPAN * i / (THERMAL_LUT_SIZE - 1)));
      samples.set([...emission.color, Math.log(Math.max(emission.strength, 1e-30))], i * 4);
    }
  }
  return samples;
}

export function thermalUniforms(enabled = true) {
  const texture = enabled ? new DataTexture(thermalLutSamples(), THERMAL_LUT_SIZE, 1, RGBAFormat, FloatType) : null;
  if (texture) {
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  }
  return { uThermalLut: { value: texture }, uSurfaceExposure: { value: 1 }, uSurfaceTemperatureK: { value: 0 } };
}

export function ownThermalTexture(material: ShaderMaterial): ShaderMaterial {
  material.addEventListener('dispose', () => material.uniforms.uThermalLut.value?.dispose());
  return material;
}

export const THERMAL_EMISSION_GLSL = /* glsl */ `
uniform sampler2D uThermalLut;
uniform float uSurfaceExposure;
uniform float uSurfaceTemperatureK;
vec3 surfaceThermal(float temperatureK) {
  // Below 400 K optical power is negligible even at maximum scene gain.
  if (temperatureK < ${THERMAL_MIN_K.toFixed(1)}) return vec3(0.0);
  float t = clamp((log(temperatureK) - ${LOG_MIN}) / ${LOG_SPAN}, 0.0, 1.0);
  vec4 emission = texture2D(uThermalLut, vec2((t * ${THERMAL_LUT_SIZE - 1}.0 + 0.5) / ${THERMAL_LUT_SIZE}.0, 0.5));
  return emission.rgb * exp(emission.a) * uSurfaceExposure;
}
`;
