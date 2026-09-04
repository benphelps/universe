import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { reflectedFluxRatio, reflectedLightColor, shineTint } from './reflectedLight';

const moonAnalog = (positionKm: Vector3) => ({
  positionKm,
  radiusKm: 1737,
  bondAlbedo: 0.11,
  tint: [1, 1, 1] as [number, number, number],
});

describe('reflectedFluxRatio', () => {
  it('a full Moon over Earth delivers about two millionths of sunlight', () => {
    const body = moonAnalog(new Vector3(384400, 0, 0));
    // Sun on the far side of the observer: the body sees it behind us.
    const ratio = reflectedFluxRatio(body, new Vector3(-1, 0, 0));
    expect(ratio).toBeGreaterThan(1.5e-6);
    expect(ratio).toBeLessThan(3e-6);
  });

  it('a new moon goes dark', () => {
    const body = moonAnalog(new Vector3(384400, 0, 0));
    expect(reflectedFluxRatio(body, new Vector3(1, 0, 0))).toBeLessThan(1e-12);
  });

  it('a quarter phase sits between new and full', () => {
    const body = moonAnalog(new Vector3(384400, 0, 0));
    const full = reflectedFluxRatio(body, new Vector3(-1, 0, 0));
    const quarter = reflectedFluxRatio(body, new Vector3(0, 1, 0));
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(full * 0.5);
  });

  it('grows with proximity as inverse square', () => {
    const far = reflectedFluxRatio(moonAnalog(new Vector3(384400, 0, 0)), new Vector3(-1, 0, 0));
    const near = reflectedFluxRatio(moonAnalog(new Vector3(192200, 0, 0)), new Vector3(-1, 0, 0));
    expect(near / far).toBeCloseTo(4, 1);
  });
});

describe('reflectedLightColor', () => {
  it('keeps reflected light linear through the former night threshold', () => {
    const host = [1, 0.8, 0.6] as const;
    const tint = [0.7, 0.8, 1] as const;
    const dim = reflectedLightColor(host, tint, 0.004 - 1e-6);
    const bright = reflectedLightColor(host, tint, 0.004 + 1e-6);

    for (let channel = 0; channel < 3; channel++) {
      expect(dim[channel]).toBeGreaterThan(0);
      expect(bright[channel] / dim[channel]).toBeCloseTo(
        (0.004 + 1e-6) / (0.004 - 1e-6),
        8,
      );
    }
  });
});

describe('shineTint', () => {
  const appearance = {
    landColorA: [0.4, 0.3, 0.2] as [number, number, number],
    landColorB: [0, 0, 0] as [number, number, number],
    oceanColor: [0, 0, 0] as [number, number, number],
    iceColor: [0, 0, 0] as [number, number, number],
    clouds: {
      condensate: 'water' as const,
      coverage: 0,
      opticalDepth: 12,
      topAltitudeKm: 10,
      thicknessKm: 4,
      featureScaleKm: 1500,
      driftRadPerDay: 0.2,
      relief: 0.7,
      stellarBias: 0,
      color: [0.9, 0.9, 1.0] as [number, number, number],
    },
    lavaGlow: 0,
    banding: null,
  };

  it('an airless body shines with its ground chroma, peak-normalized', () => {
    const tint = shineTint(appearance);
    expect(tint[0]).toBe(1);
    expect(tint[1]).toBeCloseTo(0.75, 5);
    expect(tint[2]).toBeCloseTo(0.5, 5);
  });

  it('clouds whiten the shine', () => {
    const tint = shineTint({
      ...appearance,
      clouds: { ...appearance.clouds, coverage: 1 },
    });
    expect(tint[1]).toBeGreaterThan(0.85);
    expect(tint[2]).toBeGreaterThan(tint[1]);
  });
});
