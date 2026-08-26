import { describe, expect, it } from 'vitest';
import {
  activeStorms,
  deriveCirculation,
  profileLatRad,
  type Circulation,
} from './circulation';
import type { Characterization } from './types';

function giant(overrides: {
  seedHex?: string;
  periodHours?: number;
  heatFluxWm2?: number;
  equilibriumK?: number;
  magneticFieldRelEarth?: number;
  locked?: boolean;
  radiusEarth?: number;
}): Characterization {
  return {
    seedHex: overrides.seedHex ?? '00000000deadbeef',
    bulk: {
      massEarth: 318,
      radiusEarth: overrides.radiusEarth ?? 11,
      densityGcc: 1.3,
      gravityMs2: 24,
      escapeVelocityKms: 60,
      oblateness: 0.06,
    },
    interior: {
      ironCoreFraction: 0,
      heatFluxWm2: overrides.heatFluxWm2 ?? 5.4,
      regime: 'gas',
      magneticFieldRelEarth: overrides.magneticFieldRelEarth ?? 20,
    },
    rotation: {
      periodHours: overrides.periodHours ?? 10,
      obliquityRad: 0.05,
      locked: overrides.locked ?? false,
      spinOrbitResonance: null,
    },
    atmosphere: {
      class: 'hydrogen-helium',
      surfacePressureBar: 1000,
      scaleHeightKm: 27,
      opticalDepth: 5,
      scatteringColor: [0.6, 0.7, 0.8],
    },
    climate: {
      equilibriumK: overrides.equilibriumK ?? 110,
      surfaceMeanK: overrides.equilibriumK ?? 110,
      bondAlbedo: 0.34,
      iceCapLatitudeRad: Math.PI / 2,
      hydrosphere: 'none',
      oceanCoverage: 0,
      dayNightDeltaK: 0,
      snowball: false,
      biosphere: false,
      co2Bar: 0,
    },
    appearance: {
      landColorA: [0, 0, 0],
      landColorB: [0, 0, 0],
      oceanColor: [0, 0, 0],
      iceColor: [0, 0, 0],
      cloudCoverage: 1,
      cloudColor: [1, 1, 1],
      lavaGlow: 0,
      banding: null,
    },
  };
}

function jetCount(circulation: Circulation): number {
  const u = circulation.uProfileMs;
  let extrema = 0;
  for (let i = 1; i < u.length - 1; i++) {
    if ((u[i] - u[i - 1]) * (u[i + 1] - u[i]) < 0) extrema++;
  }
  return extrema;
}

describe('deriveCirculation', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a1 = deriveCirculation(giant({ seedHex: 'aaaaaaaaaaaaaaaa' }));
    const a2 = deriveCirculation(giant({ seedHex: 'aaaaaaaaaaaaaaaa' }));
    const b = deriveCirculation(giant({ seedHex: 'bbbbbbbbbbbbbbbb' }));
    expect(a1.bands).toEqual(a2.bands);
    expect(Array.from(a1.uProfileMs)).toEqual(Array.from(a2.uProfileMs));
    expect(a1.bands).not.toEqual(b.bands);
  });

  it('fast hot rotators band finely, slow cold ones broadly', () => {
    const jupiter = deriveCirculation(giant({ periodHours: 10, heatFluxWm2: 5.4 }));
    const sluggard = deriveCirculation(giant({ periodHours: 220, heatFluxWm2: 0.3 }));
    expect(jupiter.bands.length).toBeGreaterThanOrEqual(8);
    expect(sluggard.bands.length).toBeLessThan(jupiter.bands.length);
    expect(jetCount(jupiter)).toBeGreaterThan(jetCount(sluggard));
  });

  it('jet speeds emerge at gas-giant scale', () => {
    const c = deriveCirculation(giant({}));
    let peak = 0;
    for (const u of c.uProfileMs) peak = Math.max(peak, Math.abs(u));
    expect(peak).toBeGreaterThan(30);
    expect(peak).toBeLessThan(600);
  });

  it('warm giants superrotate at the equator; cold methane ones do not', () => {
    const warm = deriveCirculation(giant({ equilibriumK: 110 }));
    const cold = deriveCirculation(giant({ equilibriumK: 60 }));
    const eq = Math.floor(warm.uProfileMs.length / 2);
    expect(warm.uProfileMs[eq]).toBeGreaterThan(0);
    expect(cold.uProfileMs[eq]).toBeLessThan(0);
  });

  it('zones and belts alternate out of the shear, covering the globe', () => {
    const c = deriveCirculation(giant({}));
    expect(c.bands.some((band) => band.kind === 'zone')).toBe(true);
    expect(c.bands.some((band) => band.kind === 'belt')).toBe(true);
    for (let i = 1; i < c.bands.length; i++) {
      expect(c.bands[i].latStartRad).toBeCloseTo(c.bands[i - 1].latEndRad, 6);
    }
    expect(c.bands[0].latStartRad).toBeCloseTo(profileLatRad(0), 6);
  });

  it('quiet interiors wash out; vigorous ones stay vivid and stormy', () => {
    const uranus = deriveCirculation(giant({ heatFluxWm2: 0.04 }));
    const jupiter = deriveCirculation(giant({ heatFluxWm2: 5.4 }));
    expect(uranus.contrast).toBeLessThan(0.45);
    expect(jupiter.contrast).toBeGreaterThan(0.8);
    expect(jupiter.storms.length).toBeGreaterThan(uranus.storms.length);
  });

  it('aurora needs a dynamo', () => {
    expect(deriveCirculation(giant({ magneticFieldRelEarth: 0 })).auroraStrength).toBe(0);
    expect(
      deriveCirculation(giant({ magneticFieldRelEarth: 20 })).auroraStrength,
    ).toBeGreaterThan(0.3);
  });

  it('locked giants trade bands for a shifted hotspot', () => {
    const locked = deriveCirculation(giant({ locked: true, equilibriumK: 1400 }));
    expect(locked.regime).toBe('locked');
    expect(locked.hotspotOffsetRad).toBeGreaterThan(0);
    expect(locked.thermalGlowK).toBeGreaterThan(700);
  });
});

describe('activeStorms', () => {
  it('is a pure function of time with population turnover', () => {
    const c = deriveCirculation(giant({}));
    const now = activeStorms(c, 5000);
    const again = activeStorms(c, 5000);
    expect(now).toEqual(again);
    const later = activeStorms(c, 9000);
    const key = (s: { latRad: number; sizeRad: number }) =>
      `${s.latRad.toFixed(4)}:${s.sizeRad.toFixed(4)}`;
    expect(new Set(later.map(key))).not.toEqual(new Set(now.map(key)));
  });

  it('keeps storms inside their bands and the spot alive forever', () => {
    const seeds = ['1111111111111111', '2222222222222222', '3333333333333333'];
    for (const seedHex of seeds) {
      const c = deriveCirculation(giant({ seedHex }));
      for (const t of [0, 1000, 50000]) {
        for (const storm of activeStorms(c, t)) {
          expect(Math.abs(storm.latRad)).toBeLessThan(1.45);
          expect(storm.sizeRad).toBeGreaterThan(0);
        }
      }
      if (c.spotIndex >= 0) {
        for (const t of [0, 20000, 200000]) {
          expect(activeStorms(c, t).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('spot analogs sit at different seeded latitudes with different drift', () => {
    const spots: Array<{ lat: number; drift: number }> = [];
    for (let i = 0; i < 24 && spots.length < 3; i++) {
      const c = deriveCirculation(giant({ seedHex: i.toString(16).padStart(16, '0') }));
      if (c.spotIndex >= 0) {
        const slot = c.storms[c.spotIndex];
        const band = c.bands[slot.band];
        spots.push({
          lat: (band.latStartRad + band.latEndRad) / 2,
          drift: slot.driftRadPerDay,
        });
      }
    }
    expect(spots.length).toBeGreaterThanOrEqual(2);
    expect(spots[0].lat).not.toBeCloseTo(spots[1].lat, 3);
    expect(spots[0].drift).not.toBeCloseTo(spots[1].drift, 6);
  });
});
