import { expect, it, vi } from 'vitest';
import { blackbodySurfaceEmission } from '../lighting/thermalEmission';
import { giantFixture, GIANT_REFERENCES } from '../../universe/planet/__fixtures__/giants';
import { giantTemperatureK } from '../../universe/planet/giantAtmosphere';
import { giantThermalLookup, GIANT_THERMAL_SAMPLES } from './giantThermal';

it('interpolates the visible Planck integral without replacing it with bolometric brightness', () => {
  const state = giantFixture(GIANT_REFERENCES[4]).appearance.banding!.atmosphere!;
  const { texture, strength } = giantThermalLookup(state);
  const data = texture.image.data as Float32Array;
  for (const cosine of [-1, -.75, -.13, .35, .83, 1]) {
    const x = (cosine + 1) / 2 * (GIANT_THERMAL_SAMPLES - 1), a = Math.floor(x), b = Math.min(a + 1, GIANT_THERMAL_SAMPLES - 1);
    const reference = blackbodySurfaceEmission(giantTemperatureK(state, cosine));
    for (let c = 0; c < 3; c++) {
      const actual = (data[a * 4 + c] * (1 - (x - a)) + data[b * 4 + c] * (x - a)) * strength;
      expect(Math.abs(actual - reference.color[c] * reference.strength) / Math.max(reference.strength, 1e-30)).toBeLessThan(.001);
    }
  }
  texture.dispose();
});


it('releases a giant thermal lookup when its material is disposed', async () => {
  const { createGiantMaterial } = await import('./giantMaterial');
  const { deriveCirculation } = await import('../../universe/planet/circulation');
  const physical = giantFixture(GIANT_REFERENCES[4]);
  const material = createGiantMaterial(physical, deriveCirculation(physical));
  const dispose = vi.spyOn(material.uniforms.uThermalProfile.value, 'dispose');
  material.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});
