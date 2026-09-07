import { describe, expect, it } from 'vitest';
import { cloudsInCell } from './clouds';
import { DUST_OPACITY_PER_PC } from './density';
import { attenuateNebulaContinuum, planNebulaBake, type NebulaBakeFields } from './nebulaVolume';

describe('continuum attenuation through final dust', () => {
  const cloud = cloudsInCell(15, -5, 0)[0];
  for (const source of [[0, 0, 0], [0.7, -0.3, 0.2], [-5, 0, 0], [4, -6, 3]] as [number, number, number][]) {
    it(`matches a uniform column from ${source}`, () => {
      const size = 12, boxPc = 2, density = 0.4;
      const plan = { ...planNebulaBake(cloud, null, size, boxPc),
        scatterSourcePc: source, scatterLuminositySolar: 1 };
      const fields: NebulaBakeFields = {
        dust: new Float32Array(size ** 3).fill(density), hydrogen: new Float32Array(0),
        ionized: new Float32Array(0), hardness: new Float32Array(0), transmittance: new Float32Array(size ** 3),
      };
      attenuateNebulaContinuum(plan, fields);
      for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const point = [i, j, k].map(v => (v + 0.5) * plan.cellPc - boxPc);
        const towardSource = source.map((v, axis) => v - point[axis]);
        // Independently clip from the interior target toward the source.
        let fraction = 1;
        for (let axis = 0; axis < 3; axis++) if (towardSource[axis] !== 0) {
          fraction = Math.min(fraction, (Math.sign(towardSource[axis]) * boxPc - point[axis]) / towardSource[axis]);
        }
        const expected = Math.exp(-DUST_OPACITY_PER_PC * density * Math.hypot(...towardSource) * fraction);
        expect(fields.transmittance[(k * size + j) * size + i]).toBeCloseTo(expected, 6);
      }
      expect(fields.dust[0]).toBeCloseTo(density, 7);
    });
  }
});

import { bakeContinuum, continuumSources, sampleContinuum, stellarContinuum, opticalLuminosityFraction, type ContinuumGrid } from './nebulaContinuum';
import { hgPhase, SCATTER_OPACITY_RGB } from './dustScattering';

describe('resolved optical continuum', () => {
  const grid: ContinuumGrid = { size: 12, boxPc: 6, cellPc: 1, originPc: [0, 0, 0], sources: [] };
  it('matches independent Planck-band integrals and keeps optical power separate from bolometric power', () => {
    // Dimensionless integral 15/pi^4 ∫ x^3/(exp(x)-1) dx,
    // evaluated with 100,000 Simpson intervals independently of λ bins.
    for (const [temperature, fraction] of [[5772, 0.46496980417802714], [10000, 0.4045955314735442], [40000, 0.02579373943872987]]) {
      const value = opticalLuminosityFraction(temperature);
      expect(value).toBeGreaterThan(0); expect(value).toBeLessThan(1);
      // Exact anchors are recorded by the independent validation probe.
      expect(Math.abs(value / fraction - 1)).toBeLessThan(1e-4);
    }
    expect(opticalLuminosityFraction(40000)).toBeLessThan(opticalLuminosityFraction(10000) / 10);
    const source = stellarContinuum([0, 0, 0], 100, 10000);
    expect(source.luminositySolar).toBeCloseTo(100 * opticalLuminosityFraction(10000), 10);
    expect(source.color[0] * 0.2126 + source.color[1] * 0.7152 + source.color[2] * 0.0722).toBeCloseTo(1, 12);
  });

  it('retains power, colour and centroid when grouping only unresolved members', () => {
    const a = stellarContinuum([0.1, 0.2, 0.3], 100, 8000), b = stellarContinuum([0.9, 0.8, 0.7], 50, 20000);
    const c = stellarContinuum([2.1, 0.2, 0.3], 1, 6000), sources = [a, b, c];
    const grouped = continuumSources({ ...grid, sources });
    expect(grouped).toEqual(continuumSources({ ...grid, sources: [...sources].reverse() }));
    expect(grouped).toHaveLength(2);
    expect(grouped[0].luminositySolar).toBeCloseTo(a.luminositySolar + b.luminositySolar, 12);
    expect(grouped[0].positionPc[0]).toBeCloseTo((a.positionPc[0] * a.luminositySolar + b.positionPc[0] * b.luminositySolar) / grouped[0].luminositySolar, 12);
  });

  it('matches single-source inverse-square dilution, RGB columns and the HG phase', () => {
    const density = 0.1, source = { positionPc: [0, 0, 0] as [number, number, number], luminositySolar: 100, color: [1, 1, 1] as [number, number, number] };
    const field = bakeContinuum({ ...grid, sources: [source] }, () => density);
    const out = new Float64Array(3), point = [2.5, 0.5, 0.5], r = Math.hypot(...point);
    const view = point.map(v => -v / r);
    sampleContinuum(field, point.map(v => (v + grid.boxPc) / (2 * grid.boxPc)), out, view);
    for (let c = 0; c < 3; c++) {
      const expected = 100 / r ** 2 * SCATTER_OPACITY_RGB[c] * Math.exp(-density * DUST_OPACITY_PER_PC * r * SCATTER_OPACITY_RGB[c]) * hgPhase(1);
      expect(Math.abs(out[c] / expected - 1)).toBeLessThan(0.025);
    }
  });

  it('keeps separated coloured illuminants and normalized angular power', () => {
    const field = bakeContinuum({ ...grid, sources: [
      { positionPc: [-3, 0, 0], luminositySolar: 100, color: [2, 0.5, 0.1] },
      { positionPc: [3, 0, 0], luminositySolar: 100, color: [0.1, 0.5, 2] },
    ] }, (x) => Math.abs(x) < 0.4 ? 2 : 0);
    const left = new Float64Array(3), right = new Float64Array(3);
    sampleContinuum(field, [0.25, 0.5, 0.5], left); sampleContinuum(field, [0.75, 0.5, 0.5], right);
    expect(left[0]).toBeGreaterThan(left[2] * 5); expect(right[2]).toBeGreaterThan(right[0] * 5);
    const point = [0.25, 0.5, 0.5], average = new Float64Array(3), value = new Float64Array(3);
    sampleContinuum(field, point, average);
    let sum = 0; const count = 2000;
    for (let i = 0; i < count; i++) {
      const z = 1 - 2 * (i + 0.5) / count, phi = i * Math.PI * (3 - Math.sqrt(5)), r = Math.sqrt(1 - z * z);
      sampleContinuum(field, point, value, [r * Math.cos(phi), r * Math.sin(phi), z]); sum += value[0];
    }
    expect(sum / count / average[0]).toBeCloseTo(1, 3);
    expect(field.luminositySolar).toBe(200);
    expect(field.data.byteLength).toBeLessThanOrEqual(24 ** 3 * 16);
  });
});
