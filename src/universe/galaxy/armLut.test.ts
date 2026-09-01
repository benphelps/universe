import { describe, expect, it } from 'vitest';
import {
  ARM_LUT_RADIUS_MAX_PC,
  ARM_LUT_RADIUS_MIN_PC,
  ARM_LUT_SIZE,
  armLutAzimuthRad,
  armLutRadiusPc,
  bakeArmLut,
} from './armLut';
import { ARM_BOOST_MAX, armProfile } from './density';

/** Bilinear read of the baked grid with the texture's own wrapping:
 *  azimuth repeats, radius clamps — what the sampler will do. */
function lutSample(lut: Float32Array, radiusPc: number, azimuthRad: number): [number, number] {
  const logSpan = Math.log(ARM_LUT_RADIUS_MAX_PC / ARM_LUT_RADIUS_MIN_PC);
  const v = (Math.log(radiusPc / ARM_LUT_RADIUS_MIN_PC) / logSpan) * ARM_LUT_SIZE - 0.5;
  const u = (azimuthRad / (2 * Math.PI)) * ARM_LUT_SIZE - 0.5;
  const row = Math.floor(v);
  const col = Math.floor(u);
  const fv = v - row;
  const fu = u - col;
  const at = (r: number, c: number, channel: number): number => {
    const rc = Math.min(ARM_LUT_SIZE - 1, Math.max(0, r));
    const cc = ((c % ARM_LUT_SIZE) + ARM_LUT_SIZE) % ARM_LUT_SIZE;
    return lut[(rc * ARM_LUT_SIZE + cc) * 2 + channel];
  };
  const read = (channel: number): number => {
    const a = at(row, col, channel) + (at(row, col + 1, channel) - at(row, col, channel)) * fu;
    const b =
      at(row + 1, col, channel) + (at(row + 1, col + 1, channel) - at(row + 1, col, channel)) * fu;
    return a + (b - a) * fv;
  };
  return [read(0), read(1)];
}

describe('arm profile LUT', () => {
  const lut = bakeArmLut();

  it('holds the model exactly at texel centres', () => {
    for (let i = 0; i < 100; i++) {
      const row = Math.floor(Math.random() * ARM_LUT_SIZE);
      const col = Math.floor(Math.random() * ARM_LUT_SIZE);
      const { boost, lane } = armProfile(armLutRadiusPc(row), armLutAzimuthRad(col));
      expect(lut[(row * ARM_LUT_SIZE + col) * 2]).toBe(Math.fround(boost));
      expect(lut[(row * ARM_LUT_SIZE + col) * 2 + 1]).toBe(Math.fround(lane));
    }
  });

  it('reconstructs the profile between texels', () => {
    let worst = 0;
    let sum = 0;
    const samples = 2000;
    for (let i = 0; i < samples; i++) {
      const radiusPc = 1000 * Math.exp(Math.random() * Math.log(20));
      const azimuthRad = Math.random() * 2 * Math.PI;
      const direct = armProfile(radiusPc, azimuthRad);
      const [boost, lane] = lutSample(lut, radiusPc, azimuthRad);
      const err = Math.max(Math.abs(boost - direct.boost), Math.abs(lane - direct.lane));
      worst = Math.max(worst, err);
      sum += err;
    }
    // The caustic ridges are the sharpest thing in the profile. The
    // grid rounds their peaks by a few percent of their height, which
    // is under what the march's own arm-holding cadence smears; the
    // mean is what the glow integrates, and it barely moves.
    expect(sum / samples).toBeLessThan(0.01);
    expect(worst).toBeLessThan(0.4);
  });

  it('stays inside the model ceiling and dies at both radial edges', () => {
    let peak = 0;
    for (let i = 0; i < lut.length; i += 2) peak = Math.max(peak, lut[i]);
    expect(1 + peak).toBeLessThanOrEqual(ARM_BOOST_MAX);
    for (let col = 0; col < ARM_LUT_SIZE; col++) {
      expect(lut[col * 2]).toBeLessThan(0.05);
      expect(lut[((ARM_LUT_SIZE - 1) * ARM_LUT_SIZE + col) * 2]).toBeLessThan(0.05);
    }
  });
});
