import { describe, expect, it } from 'vitest';
import { AU, G, SOLAR_MASS } from '../physics/constants';
import { elementsToState, solveEccentricAnomaly } from './kepler';
import { orbitalPeriod, type OrbitalElements } from './orbit';
import { dot, length, sub } from './vec3';

const MU_SUN = G * SOLAR_MASS;

function circularElements(a: number): OrbitalElements {
  return {
    semiMajorAxis: a,
    eccentricity: 0,
    inclination: 0,
    longitudeOfAscendingNode: 0,
    argumentOfPeriapsis: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  };
}

describe('solveEccentricAnomaly', () => {
  it('satisfies Kepler equation across eccentricities and anomalies', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.97]) {
      for (let m = 0; m < 2 * Math.PI; m += 0.37) {
        const E = solveEccentricAnomaly(m, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(m, 9);
      }
    }
  });
});

describe('elementsToState', () => {
  it('circular 1 AU orbit has Earth-like period and speed', () => {
    const el = circularElements(AU);
    const period = orbitalPeriod(MU_SUN, AU);
    expect(period / 86400).toBeCloseTo(365.25, 0);
    const { position, velocity } = elementsToState(el, MU_SUN, 0);
    expect(length(position)).toBeCloseTo(AU, -3);
    expect(length(velocity)).toBeCloseTo(29780, -3);
  });

  it('quarter period sweeps a quarter turn on a circular orbit', () => {
    const el = circularElements(AU);
    const period = orbitalPeriod(MU_SUN, AU);
    const p0 = elementsToState(el, MU_SUN, 0).position;
    const p1 = elementsToState(el, MU_SUN, period / 4).position;
    expect(dot(p0, p1) / (length(p0) * length(p1))).toBeCloseTo(0, 6);
  });

  it('eccentric orbit starts at periapsis and satisfies vis-viva everywhere', () => {
    const el: OrbitalElements = { ...circularElements(2 * AU), eccentricity: 0.7 };
    const periapsis = elementsToState(el, MU_SUN, 0).position;
    expect(length(periapsis)).toBeCloseTo(2 * AU * 0.3, -6);

    const period = orbitalPeriod(MU_SUN, 2 * AU);
    for (let f = 0; f < 1; f += 0.09) {
      const { position, velocity } = elementsToState(el, MU_SUN, f * period);
      const r = length(position);
      const vSquared = dot(velocity, velocity);
      const visViva = MU_SUN * (2 / r - 1 / (2 * AU));
      expect(vSquared / visViva).toBeCloseTo(1, 8);
    }
  });

  it('propagation is exact over many periods', () => {
    const el: OrbitalElements = { ...circularElements(1.5 * AU), eccentricity: 0.3 };
    const period = orbitalPeriod(MU_SUN, 1.5 * AU);
    const a = elementsToState(el, MU_SUN, 0.123 * period).position;
    const b = elementsToState(el, MU_SUN, (1000 + 0.123) * period).position;
    expect(length(sub(a, b)) / AU).toBeLessThan(1e-5);
  });

  it('inclination tilts the orbit out of plane', () => {
    const el: OrbitalElements = { ...circularElements(AU), inclination: Math.PI / 4 };
    const period = orbitalPeriod(MU_SUN, AU);
    const p = elementsToState(el, MU_SUN, period / 4).position;
    expect(Math.abs(p.z)).toBeGreaterThan(0.1 * AU);
  });
});
