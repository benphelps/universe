import { expect, it } from 'vitest';
import { planckRadiance } from '../../core/color/planck';
import { spectrumToXyz } from '../../core/color/xyz';
import { FLOW_LOG_T_MIN, FLOW_LOG_T_MAX, FLOW_SPECTRUM_SIZE, flowSpectrumSamples, thermalVisibleSample } from './flowSpectrum';

function sample(temperatureK: number): number[] {
  const data = flowSpectrumSamples();
  const index = (Math.log2(temperatureK) - FLOW_LOG_T_MIN) / (FLOW_LOG_T_MAX - FLOW_LOG_T_MIN) * (FLOW_SPECTRUM_SIZE - 1);
  const lo = Math.max(0, Math.min(FLOW_SPECTRUM_SIZE - 2, Math.floor(index)));
  const f = Math.max(0, Math.min(1, index - lo));
  return Array.from({ length: 4 }, (_, channel) => data[4*lo+channel]*(1-f) + data[4*(lo+1)+channel]*f);
}

it('retains visible power and hue across cool outskirts and very hot inner flows', () => {
  for (const t of [500, 1100, 2750, 5772, 12500, 50000, 270000, 1e6, 1e8, 1e9]) {
    const actual = sample(t), exact = thermalVisibleSample(t);
    for (let channel = 0; channel < 3; channel++) {
      expect(actual[channel]).toBeGreaterThanOrEqual(0);
      expect(Math.abs(actual[channel] - exact[channel])).toBeLessThan(.002);
    }
    expect(Math.abs(2 ** (actual[3] - exact[3]) - 1)).toBeLessThan(.002);
  }
  expect(sample(3000)[0]).toBeGreaterThan(sample(3000)[2]);
  expect(sample(30000)[2]).toBeGreaterThan(sample(30000)[0]);
});

it('agrees with frequency-shifted Planck spectra without bolometric beaming', () => {
  for (const t of [3000, 12000, 1e6]) for (const g of [.5, .9, 1, 2]) {
    // I_lambda(lambda) = g^5 I_lambda_emitted(g*lambda).
    const received = spectrumToXyz(nm => g**5 * planckRadiance(g*nm*1e-9, t));
    const table = sample(g*t);
    expect(Math.abs(2**table[3]/received.y - 1)).toBeLessThan(.002);
  }
  // Deep in the Rayleigh–Jeans tail, doubling temperature approximately
  // doubles visible brightness; using total power would brighten it 16x.
  const ratio = 2 ** (sample(2e6)[3] - sample(1e6)[3]);
  expect(ratio).toBeGreaterThan(2);
  expect(ratio).toBeLessThan(2.03);
});

it('caches a bounded spectrum table and keeps all entries finite', () => {
  const data = flowSpectrumSamples();
  expect(flowSpectrumSamples()).toBe(data);
  expect(data.byteLength).toBe(16384);
  expect(data.every(Number.isFinite)).toBe(true);
});
