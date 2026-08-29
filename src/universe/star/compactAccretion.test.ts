import { describe, expect, it } from 'vitest';
import { SOLAR_MASS, YEAR } from '../../core/physics/constants';
import {
  bondiRate,
  feedingFor,
  overflowRate,
  solarMassesPerYear,
  windCaptureRate,
  type Donor,
} from './compactAccretion';
import { massLossRate, rocheLobeFraction, windSpeed, windSpeedAt } from './stellarWind';
import type { StellarPhysical } from './types';

const sun: StellarPhysical = {
  stage: 'main-sequence',
  mass: 1,
  luminosity: 1,
  radius: 1,
  tEff: 5772,
};
const redSupergiant: StellarPhysical = {
  stage: 'supergiant',
  mass: 18,
  luminosity: 1.3e5,
  radius: 900,
  tEff: 3600,
};
const blueSupergiant: StellarPhysical = {
  stage: 'supergiant',
  mass: 30,
  luminosity: 5e5,
  radius: 25,
  tEff: 28000,
};

describe('what stars shed', () => {
  it('gives the Sun the rate the Sun has', () => {
    expect(solarMassesPerYear(massLossRate(sun))).toBeCloseTo(2e-14, 15);
  });

  it('strips a red supergiant a billion times faster', () => {
    // Reimers on a cool, enormous, loosely bound envelope: of order
    // 10⁻⁶ M☉ a year, which is what Betelgeuse-class stars are measured
    // losing and is a solar mass every million years.
    const rate = solarMassesPerYear(massLossRate(redSupergiant));
    expect(rate).toBeGreaterThan(1e-7);
    expect(rate).toBeLessThan(1e-5);
  });

  it('drives a hot supergiant fast where a cool one is slow', () => {
    // The two shed comparable amounts — a red supergiant and an O
    // supergiant both run near 10⁻⁶ M☉ a year — but the hot one's wind
    // leaves fifty times faster, and that, not the supply, is what
    // decides whether a companion can catch any of it.
    expect(windSpeed(blueSupergiant)).toBeGreaterThan(1e6);
    expect(windSpeed(redSupergiant)).toBeLessThan(1e5);
    for (const star of [redSupergiant, blueSupergiant]) {
      const perYear = solarMassesPerYear(massLossRate(star));
      expect(perYear).toBeGreaterThan(1e-7);
      expect(perYear).toBeLessThan(1e-5);
    }
  });

  it('has not reached terminal speed a few stellar radii out', () => {
    const surface = blueSupergiant.radius * 6.957e8;
    expect(windSpeedAt(blueSupergiant, 3 * surface)).toBeCloseTo(
      windSpeed(blueSupergiant) * (2 / 3) ** 0.8,
      -2,
    );
    expect(windSpeedAt(blueSupergiant, 1e4 * surface) / windSpeed(blueSupergiant)).toBeCloseTo(1, 3);
  });
});

describe('the Roche lobe', () => {
  it('gives an equal pair the fraction Eggleton does', () => {
    expect(rocheLobeFraction(1)).toBeCloseTo(0.3789, 3);
  });

  it('grows with the donor and shrinks as it gives mass away', () => {
    expect(rocheLobeFraction(10)).toBeGreaterThan(rocheLobeFraction(1));
    expect(rocheLobeFraction(0.1)).toBeLessThan(rocheLobeFraction(1));
    // Never more than the separation, whatever the ratio.
    expect(rocheLobeFraction(1e6)).toBeLessThan(1);
  });
});

describe('feeding a stellar-mass black hole', () => {
  it('leaves a lone hole twenty orders of magnitude short of shining', () => {
    const alone = feedingFor(10, 0.7, []);
    expect(alone.mode).toBe('starved');
    expect(alone.donorIndex).toBe(-1);
    // Bondi capture from the warm neutral medium: real, and hopeless.
    expect(alone.eddingtonRatio).toBeGreaterThan(0);
    expect(alone.eddingtonRatio).toBeLessThan(1e-10);
  });

  it('lights a hole standing in a blue supergiant’s wind', () => {
    // The Cygnus X-1 arrangement: a twenty-one solar mass hole a third
    // of an astronomical unit from an O supergiant that does not quite
    // fill its lobe, living on the wind that blows past.
    const donors: Donor[] = [{ star: blueSupergiant, separationAu: 0.35 }];
    const fed = feedingFor(21, 0.9, donors);
    expect(fed.mode).toBe('wind-fed');
    expect(fed.donorIndex).toBe(0);
    // Far above a starved hole and far below Eddington: a real source.
    expect(fed.eddingtonRatio).toBeGreaterThan(1e-6);
    expect(fed.eddingtonRatio).toBeLessThan(0.1);
  });

  it('falls away as the square of the separation, where the wind wins', () => {
    // Only where the wind outruns the orbit. Far from a fast-wind star
    // the capture cylinder has a fixed radius and the geometry is pure
    // inverse square; close in, the orbital motion adds to the speed
    // the hole meets the gas at and flattens the falloff considerably.
    const near = windCaptureRate(10, blueSupergiant, 20);
    const far = windCaptureRate(10, blueSupergiant, 80);
    expect(near / far).toBeCloseTo(16, 0);
    const tightRatio =
      windCaptureRate(10, redSupergiant, 1) / windCaptureRate(10, redSupergiant, 4);
    expect(tightRatio).toBeLessThan(4);
  });

  it('catches far less of a fast wind than a slow one', () => {
    // Same distance, more material shed by the red star, but the blue
    // one's wind leaves so much faster that the capture cylinder
    // collapses — the fourth power of the speed in the denominator.
    const slow = windCaptureRate(15, redSupergiant, 3);
    const fast = windCaptureRate(15, blueSupergiant, 3);
    expect(slow).toBeGreaterThan(fast * 100);
  });

  it('switches to overflow when the donor fills its lobe', () => {
    // Same star, same hole, drawn close enough that its own radius
    // exceeds the lobe. Nothing is toggled: the geometry decides.
    const wide = feedingFor(10, 0.5, [{ star: redSupergiant, separationAu: 40 }]);
    const tight = feedingFor(10, 0.5, [{ star: redSupergiant, separationAu: 8 }]);
    expect(wide.mode).toBe('wind-fed');
    expect(tight.mode).toBe('roche-lobe');
    expect(tight.rateKgPerS).toBeGreaterThan(wide.rateKgPerS * 100);
  });

  it('transfers on the thermal time only when the donor is the heavier', () => {
    // A heavy donor deepens its own overflow and can only respond as
    // fast as it can restructure; a light one widens the orbit and is
    // held to its own far slower evolution.
    const heavy = overflowRate(10, redSupergiant);
    const light = overflowRate(40, redSupergiant);
    expect(heavy / light).toBeCloseTo(1000, -2);
  });

  it('picks whichever companion is actually reaching it', () => {
    const donors: Donor[] = [
      { star: sun, separationAu: 0.5 },
      { star: redSupergiant, separationAu: 3 },
    ];
    expect(feedingFor(12, 0.6, donors).donorIndex).toBe(1);
  });

  it('scales Bondi capture as the square of the mass', () => {
    expect(bondiRate(20, 1e-21, 3e4) / bondiRate(10, 1e-21, 3e4)).toBeCloseTo(4, 6);
  });

  it('converts to solar masses a year the way the constants do', () => {
    expect(solarMassesPerYear(SOLAR_MASS / YEAR)).toBeCloseTo(1, 12);
  });
});
