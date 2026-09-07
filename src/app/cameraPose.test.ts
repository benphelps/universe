import { describe, expect, it } from 'vitest';
import { decodeDays, decodePose, encodeDays, encodePose, type CameraPose } from './cameraPose';

describe('camera pose links', () => {
  const pose: CameraPose = {
    grounded: true,
    position: [6371.123456, -12.5, 0.000123],
    quaternion: [0.1, 0.2, 0.3, Math.sqrt(1 - 0.14)],
    target: [0, 0, 0],
    headingRad: 1.234567,
    pitchRad: -0.5,
  };

  it('round-trips a pose to millimetre precision and omits a centred anchor', () => {
    const value = encodePose(pose);
    expect(value.split('_')).toHaveLength(10);
    const back = decodePose(value)!;
    expect(back.grounded).toBe(true);
    back.position.forEach((v, i) => expect(Math.abs(v - pose.position[i])).toBeLessThan(1e-6));
    back.quaternion.forEach((v, i) => expect(Math.abs(v - pose.quaternion[i])).toBeLessThan(1e-5));
    expect(back.target).toEqual([0, 0, 0]);
    expect(back.headingRad).toBeCloseTo(pose.headingRad, 5);
    expect(back.pitchRad).toBeCloseTo(pose.pitchRad, 5);
  });

  it('keeps a panned anchor', () => {
    const back = decodePose(encodePose({ ...pose, grounded: false, target: [1, 2, 3] }))!;
    expect(back.grounded).toBe(false);
    expect(back.target).toEqual([1, 2, 3]);
  });

  it('rejects values that are not a pose', () => {
    expect(decodePose(null)).toBeNull();
    expect(decodePose('g_1_2')).toBeNull();
    expect(decodePose('x_0_0_0_0_0_0_1_0_0')).toBeNull();
    expect(decodePose('o_0_0_0_0_0_0_5_0_0')).toBeNull();
    expect(decodePose('o_0_0_nope_0_0_0_1_0_0')).toBeNull();
  });

  it('carries the clock to under a millisecond', () => {
    expect(decodeDays(encodeDays(12345.123456789))).toBeCloseTo(12345.123456789, 7);
    expect(decodeDays(null)).toBeNull();
    expect(decodeDays('soon')).toBeNull();
  });
});
