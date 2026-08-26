import { describe, expect, it } from 'vitest';
import {
  activeStorms,
  bandFade01,
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

  it('poles split into polygons, single eyes, and lone vortices by spin and forcing', () => {
    const jupiter = deriveCirculation(giant({ periodHours: 10, heatFluxWm2: 5.4 }));
    const saturn = deriveCirculation(giant({ periodHours: 10.7, heatFluxWm2: 2.0 }));
    const uranus = deriveCirculation(giant({ periodHours: 17, heatFluxWm2: 0.04 }));
    expect(jupiter.polar.cycloneCount).toBeGreaterThanOrEqual(4);
    expect(saturn.polar.cycloneCount).toBeLessThanOrEqual(2);
    expect(uranus.polar.cycloneCount).toBe(1);
  });

  it('the hexagon analog is earned by its jet, not rolled', () => {
    let hexagons = 0;
    for (let i = 0; i < 30; i++) {
      const c = deriveCirculation(giant({ seedHex: (i + 300).toString(16).padStart(16, '0') }));
      const m = Math.abs(c.polar.hexWave);
      expect(m === 0 || (m >= 3 && m <= 8)).toBe(true);
      expect(c.polar.capStartRad).toBeGreaterThan(0.9);
      expect(c.polar.capStartRad).toBeLessThan(1.45);
      if (m === 0) continue;
      hexagons++;
      // Self-consistency: the wave rides a real jet — the wind at the
      // cap latitude in the carrying hemisphere is strong.
      const hemi = Math.sign(c.polar.hexWave);
      let peak = 0;
      for (let j = 0; j < c.uProfileMs.length; j++) {
        const lat = profileLatRad(j);
        if (Math.sign(lat) !== hemi) continue;
        if (Math.abs(Math.abs(lat) - c.polar.capStartRad) > 0.04) continue;
        peak = Math.max(peak, Math.abs(c.uProfileMs[j]));
      }
      expect(peak).toBeGreaterThan(18);
    }
    expect(hexagons).toBeGreaterThan(0);
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

  it('keeps storms inside their bands at every epoch', () => {
    const seeds = ['1111111111111111', '2222222222222222', '3333333333333333'];
    for (const seedHex of seeds) {
      const c = deriveCirculation(giant({ seedHex }));
      for (const t of [0, 1000, 50000, 400000]) {
        for (const storm of activeStorms(c, t)) {
          expect(Math.abs(storm.latRad)).toBeLessThan(1.45);
          expect(storm.sizeRad).toBeGreaterThan(0);
        }
      }
    }
  });

  it('spots live a century arc: swell, long shrinking maturity, death', () => {
    let checked = 0;
    for (let i = 0; i < 40 && checked < 3; i++) {
      const c = deriveCirculation(giant({ seedHex: (i + 100).toString(16).padStart(16, '0') }));
      if (c.spotIndex < 0) continue;
      const slot = c.storms[c.spotIndex];
      expect(slot.periodDays).toBeGreaterThan(80_000);
      expect(slot.lifeDays).toBeLessThan(slot.periodDays);
      const at = (frac: number) =>
        activeStorms(c, slot.phaseDays + frac * slot.lifeDays).find((s) => s.kind === 'spot');
      const young = at(0.02);
      const mature = at(0.2);
      const old = at(0.97);
      expect(mature).toBeDefined();
      expect(mature!.sizeRad).toBeGreaterThan(at(0.9)!.sizeRad);
      if (young) expect(young.sizeRad).toBeLessThanOrEqual(mature!.sizeRad);
      if (old) expect(old.age01).toBeLessThan(mature!.age01 + 1e-9);
      // Between death and the next cycle's birth there is no spot.
      const gap = activeStorms(c, slot.phaseDays + slot.lifeDays + (slot.periodDays - slot.lifeDays) / 2);
      expect(gap.find((s) => s.kind === 'spot')).toBeUndefined();
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('seasonal eruptions run on the orbital period and stay rare', () => {
    let checked = 0;
    for (let i = 0; i < 60 && checked < 3; i++) {
      const seedHex = (i + 500).toString(16).padStart(16, '0');
      const c = deriveCirculation(giant({ seedHex }), 4000);
      const slot = c.storms.find((s) => s.kind === 'eruption');
      if (!slot) continue;
      expect(slot.periodDays).toBe(4000);
      expect(slot.lifeDays).toBeLessThan(400);
      const inWindow = activeStorms(c, slot.phaseDays + slot.lifeDays * 0.5);
      expect(inWindow.some((s) => s.kind === 'eruption')).toBe(true);
      const outside = activeStorms(c, slot.phaseDays + slot.lifeDays + 500);
      expect(outside.some((s) => s.kind === 'eruption')).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('belt fade cycles bury and revive, bounded and mostly off', () => {
    let cycling = 0;
    for (let i = 0; i < 20; i++) {
      const c = deriveCirculation(giant({ seedHex: (i + 900).toString(16).padStart(16, '0') }));
      for (const band of c.bands) {
        if (band.fadePeriodDays <= 0) {
          expect(bandFade01(band, 12345)).toBe(0);
          continue;
        }
        cycling++;
        expect(band.kind).toBe('belt');
        const vivid = bandFade01(band, (0.2 - band.fadePhase01) * band.fadePeriodDays);
        const faded = bandFade01(band, (0.85 - band.fadePhase01) * band.fadePeriodDays);
        expect(vivid).toBe(0);
        expect(faded).toBeGreaterThan(0.3);
        expect(faded).toBeLessThanOrEqual(1);
      }
    }
    expect(cycling).toBeGreaterThan(3);
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
