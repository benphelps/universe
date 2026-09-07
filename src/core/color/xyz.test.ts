import { expect, it } from 'vitest';
import { VISIBLE_MAX_NM, VISIBLE_MIN_NM, xBar, yBar, zBar } from './cmf';
import { blackbodyColor, blackbodyChromaticity, blackbodyLinearRgb } from './blackbody';
import { planckRadiance } from './planck';
import { spectrumToXyz } from './xyz';

it('retains the direct CMF quadrature exactly across stellar spectra', () => {
  for (const temperature of [1000, 2000, 5772, 15000, 50000, 200000]) {
    const spectrum = (nm: number) => planckRadiance(nm * 1e-9, temperature);
    let x = 0, y = 0, z = 0;
    for (let nm = VISIBLE_MIN_NM; nm <= VISIBLE_MAX_NM; nm += 5) {
      const power = spectrum(nm);
      x += power * xBar(nm); y += power * yBar(nm); z += power * zBar(nm);
    }
    expect(spectrumToXyz(spectrum)).toEqual({ x: x * 5, y: y * 5, z: z * 5 });
    expect(blackbodyColor(temperature)).toEqual({
      chromaticity: blackbodyChromaticity(temperature),
      linearRgb: blackbodyLinearRgb(temperature),
    });
  }
});
