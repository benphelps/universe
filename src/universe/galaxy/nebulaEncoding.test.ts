import { describe, expect, it } from 'vitest';
import { cloudsInCell } from './clouds';
import { bakeOccupancy, finishNebulaBake, planNebulaBake } from './nebulaVolume';
import { sampleNebulaPortrait } from './nebulaPortrait';

function fixture() {
  const plan = planNebulaBake(cloudsInCell(15, -5, 0)[0], null, 4, 2);
  plan.photonRate = 1e50;
  const fields = { dust: new Float32Array(64), hydrogen: new Float32Array(64).fill(100),
    ionized: new Float32Array(64).fill(0.2), hardness: new Float32Array(64), transmittance: new Float32Array(64) };
  fields.ionized[0] = 100;
  return { plan, fields };
}

describe('nebular emissivity encoding', () => {
  it('retains emission below the former density byte and never rounds up its photon demand', () => {
    const { plan, fields } = fixture(), bake = finishNebulaBake(plan, fields);
    expect(bake.data.byteLength).toBe(64 * 4);
    expect(bake.data[5]).toBe(0); expect(bake.data[7]).toBeGreaterThan(0);
    const decoded = (bake.data[5] * 256 + bake.data[7]) / 65535 * bake.densityRef;
    expect(decoded).toBeGreaterThan(0.199); expect(decoded).toBeLessThanOrEqual(fields.ionized[1]);
    expect(bake.photonAccounting.encodedRecombinationsPerSecond).toBeLessThanOrEqual(bake.photonAccounting.recombinationsPerSecond);
    expect(Math.abs(bake.photonAccounting.encodingRelativeError!)).toBeLessThan(1e-5);
  });

  it('does not skip a dust-free cell with only a low density byte', () => {
    const data = new Uint8Array(16 ** 3 * 4); data[((8 * 16 + 8) * 16 + 8) * 4 + 3] = 1;
    expect(bakeOccupancy(data, 16).some(v => v > 0)).toBe(true);
  });

  it('interpolates local line power instead of assigning every cell the volume average', () => {
    const { plan, fields } = fixture(); fields.ionized.fill(10); fields.hardness[1] = 1;
    const bake = finishNebulaBake(plan, fields), cool = new Float64Array(4), hot = new Float64Array(4);
    sampleNebulaPortrait(bake, -1.5, -1.5, -1.5, cool); sampleNebulaPortrait(bake, -0.5, -1.5, -1.5, hot);
    expect(hot[1]).toBeGreaterThan(cool[1]);
    expect(hot[1] / cool[1]).toBeCloseTo(bake.emissionHotCoefficient / bake.emissionCoefficient, 12);
    const before = cool[1]; fields.hardness.fill(1); fields.hardness[0] = 0;
    sampleNebulaPortrait(finishNebulaBake(plan, fields), -1.5, -1.5, -1.5, cool);
    expect(cool[1]).toBe(before);
  });
});
