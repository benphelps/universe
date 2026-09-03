import { describe, expect, it } from 'vitest';
import { blackbodySurfaceEmission } from './thermalEmission';

describe('blackbody surface emission', () => {
  it('brightens monotonically with temperature', () => {
    expect(blackbodySurfaceEmission(2200).strength).toBeGreaterThan(
      blackbodySurfaceEmission(1400).strength,
    );
  });

  it('keeps molten silicate emission red-dominant', () => {
    const emission = blackbodySurfaceEmission(1800);
    expect(emission.color[0]).toBeGreaterThan(emission.color[1]);
    expect(emission.color[1]).toBeGreaterThan(emission.color[2]);
    expect(emission.strength).toBeGreaterThan(1);
  });
});
