import { DataTexture, FloatType, LinearFilter, RGBAFormat } from 'three';
import { giantTemperatureK, type GiantAtmosphereState } from '../../universe/planet/giantAtmosphere';
import { blackbodySurfaceEmission } from '../lighting/thermalEmission';

export const GIANT_THERMAL_SAMPLES = 256;

/** Visible-band Planck integral, sampled along the physical T^4 dipole.
 * Store absolute radiance relative to its maximum so cold giants do not
 * underflow float textures; exposure remains a separate linear multiplier. */
export function giantThermalLookup(state: GiantAtmosphereState) {
  const data = new Float32Array(GIANT_THERMAL_SAMPLES * 4);
  const peak = blackbodySurfaceEmission(giantTemperatureK(state, 1)).strength;
  for (let i = 0; i < GIANT_THERMAL_SAMPLES; i++) {
    const emission = blackbodySurfaceEmission(giantTemperatureK(state, 2 * i / (GIANT_THERMAL_SAMPLES - 1) - 1));
    for (let c = 0; c < 3; c++) data[i * 4 + c] = peak > 0 ? emission.color[c] * emission.strength / peak : 0;
    data[i * 4 + 3] = 1;
  }
  const texture = new DataTexture(data, GIANT_THERMAL_SAMPLES, 1, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return { texture, strength: peak };
}
