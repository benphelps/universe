import { describe, expect, it } from 'vitest';
import { foldShaderTime, SHADER_TIME_FOLD } from './shaderTime';

describe('foldShaderTime', () => {
  it('is the identity inside the window', () => {
    expect(foldShaderTime(17.5)).toBe(17.5);
  });

  it('bounds any sim time into the window', () => {
    const folded = foldShaderTime(1e9 + 3.25);
    expect(folded).toBeGreaterThanOrEqual(0);
    expect(folded).toBeLessThan(SHADER_TIME_FOLD);
  });

  it('folds negative time into the window', () => {
    expect(foldShaderTime(-1)).toBe(SHADER_TIME_FOLD - 1);
  });

  it('folds equal times equally across periods', () => {
    expect(foldShaderTime(SHADER_TIME_FOLD * 7 + 41)).toBeCloseTo(41, 9);
  });
});
