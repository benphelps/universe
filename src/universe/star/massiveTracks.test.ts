import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { C_LIGHT, GYR, SOLAR_LUMINOSITY, SOLAR_MASS } from '../../core/physics/constants';
import { evolve, luminousLifetimeGyr } from './evolution';
import { msLifetimeGyr, zamsLuminosity } from './mainSequence';
import { massiveAgeBreaksGyr, massiveStarState } from './massiveTracks';

const raw = readFileSync(new URL('../../../data/reference/geneva-z014-v04.tsv', import.meta.url), 'utf8');
const reference = new Map<number, number[][]>();
for (const line of raw.split('\n')) {
  const row = line.trim().split(/\s+/).map(Number);
  if (row.length !== 6 || !row.every(Number.isFinite)) continue;
  const rows = reference.get(row[0]) ?? [];
  rows.push(row); reference.set(row[0], rows);
}
function meanL(a: number, b: number): number {
  return Math.abs(b / a - 1) < 1e-10 ? a : (b - a) / Math.log(b / a);
}
function trackEnergy(mass: number): number {
  const ages = [...new Set(massiveAgeBreaksGyr(mass))];
  let energy = 0;
  for (let i = 1; i < ages.length; i++) {
    // Interior midpoint samples test the runtime interpolator independently
    // of the tabulated endpoints, including arbitrary intermediate masses.
    const dt = (ages[i] - ages[i - 1]) / 32;
    for (let j = 0; j < 32; j++) energy += dt * evolve(mass, ages[i - 1] + (j + 0.5) * dt).luminosity;
  }
  return energy;
}

describe('massive reference-track interpolation', () => {
  it('retains the published luminosity, temperature, mass and phase clock across all source rows', () => {
    expect([...reference.keys()]).toEqual([9, 12, 15, 20, 25, 32, 40, 60, 85, 120]);
    for (const [mass, rows] of reference) {
      expect(rows).toHaveLength(400);
      const origin = rows[0][2];
      // Rounded duplicate ages have no resolvable elapsed time: the last
      // state at each age is the right-continuous reference.
      const byAge = new Map(rows.map(row => [row[2], row]));
      for (const row of byAge.values()) {
        const state = massiveStarState(mass, (row[2] - origin) / 1e9);
        expect(Math.abs(Math.log10(state.luminosity) - row[4])).toBeLessThan(0.00601);
        expect(Math.abs(Math.log10(state.tEff) - row[5])).toBeLessThan(0.00401);
        expect(Math.abs(state.mass - row[3]) / mass).toBeLessThan(0.002001);
      }
      expect(msLifetimeGyr(mass)).toBeCloseTo((rows[109][2] - origin) / 1e9, 11);
      expect(luminousLifetimeGyr(mass)).toBeCloseTo((rows[399][2] - origin) / 1e9, 11);
      expect(zamsLuminosity(mass) / 10 ** rows[0][4]).toBeCloseTo(1, 10);
      let originalEnergy = 0;
      const unique = [...byAge.values()];
      for (let i = 1; i < unique.length; i++) originalEnergy += (unique[i][2] - unique[i - 1][2]) / 1e9
        * meanL(10 ** unique[i - 1][4], 10 ** unique[i][4]);
      expect(Math.abs(trackEnergy(mass) / originalEnergy - 1)).toBeLessThan(0.003);
    }
  });

  it('keeps integrated energy below available H/He fuel between the reference masses', () => {
    for (let i = 0; i <= 64; i++) {
      const mass = 8 * (120 / 8) ** (i / 64);
      const fraction = trackEnergy(mass) * SOLAR_LUMINOSITY * GYR / (mass * SOLAR_MASS * C_LIGHT ** 2);
      // X=0.720 in the Geneva grid. This is an upper bound, not an assertion
      // that every atom participates in the actual fusion-burning core.
      expect(fraction).toBeLessThan(0.720 * 0.007 + 0.0006);
      expect(fraction).toBeGreaterThan(0.0005);
    }
  });

  it('never recovers lost wind mass through interpolation or remnant formation', () => {
    for (let i = 0; i <= 160; i++) {
      const mass = 8 * (120 / 8) ** (i / 160);
      let previous = mass;
      for (const age of [...massiveAgeBreaksGyr(mass), luminousLifetimeGyr(mass) + 0.01]) {
        const star = evolve(mass, age);
        expect(star.mass).toBeGreaterThan(0);
        expect(star.mass).toBeLessThanOrEqual(previous + 1e-8);
        expect(star.radius).toBeGreaterThan(0);
        previous = star.mass;
      }
    }
    const late = massiveStarState(60, luminousLifetimeGyr(60));
    expect(late.tEff).toBeGreaterThan(50000);
    expect(late.mass).toBeLessThan(20);
    expect(evolve(60, luminousLifetimeGyr(60) + 1e-8).mass).toBeLessThanOrEqual(late.mass);
  });
});
