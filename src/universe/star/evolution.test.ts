import { describe, expect, it } from 'vitest';
import { C_LIGHT, GYR, SOLAR_LUMINOSITY, SOLAR_MASS } from '../../core/physics/constants';
import { evolve, evolutionAgeBreaksGyr, luminousLifetimeGyr, whiteDwarfMass } from './evolution';
import { msLifetimeGyr } from './mainSequence';

function integratedEnergy(mass: number): number {
  const end = luminousLifetimeGyr(mass);
  const bounds = [0, ...evolutionAgeBreaksGyr(mass).filter(t => t <= end)];
  let energy = 0;
  for (let b = 1; b < bounds.length; b++) {
    const dt = (bounds[b] - bounds[b - 1]) / 500;
    for (let i = 0; i < 500; i++) energy += dt * evolve(mass, bounds[b - 1] + (i + 0.5) * dt).luminosity;
  }
  return energy * SOLAR_LUMINOSITY * GYR / (SOLAR_MASS * C_LIGHT ** 2);
}

describe('fuel-limited white-dwarf progenitors', () => {
  it('cannot radiate more than the retained H/He fuel, including its main sequence', () => {
    // Independent numerical L dt integration, not the clock's analytic means.
    for (let i = 0; i <= 40; i++) {
      const mass = 0.8 * (7.99 / 0.8) ** (i / 40);
      const radiatedMass = integratedEnergy(mass);
      const budget = whiteDwarfMass(mass) * (0.70 * 0.007 + 0.0006);
      expect(radiatedMass).toBeLessThanOrEqual(budget * (1 + 1e-5));
      expect(radiatedMass / budget).toBeGreaterThan(0.9999);
      expect(radiatedMass / mass).toBeLessThan(0.004);
    }
  });

  it('resolves a brief AGB and roughly a hundred-Myr helium-burning phase for a solar-mass star', () => {
    const bounds = evolutionAgeBreaksGyr(1).slice(0, 13);
    const rgbEnd = bounds[9], heEnd = bounds[11], end = bounds[12];
    expect((heEnd - rgbEnd) * 1000).toBeGreaterThan(80);
    expect((heEnd - rgbEnd) * 1000).toBeLessThan(180);
    expect((end - heEnd) * 1000).toBeGreaterThan(1);
    expect((end - heEnd) * 1000).toBeLessThan(15);
    // The RGB is not uniformly luminous: it spends most of its time near
    // the base and only briefly visits the high-luminosity tip.
    const mid = evolve(1, (bounds[1] + rgbEnd) / 2);
    const tip = evolve(1, rgbEnd - 1e-8);
    expect(mid.stage).toBe('giant');
    expect(mid.luminosity).toBeLessThan(tip.luminosity / 100);
    expect(evolve(1, (heEnd + end) / 2).stage).toBe('agb');
    expect(evolve(1, end + 1e-8).stage).toBe('white-dwarf');
  });

  it('keeps phase boundaries finite, mass nonincreasing and L/R/T consistent', () => {
    const equalRgbAnchors = (2500 / (2.2 * 0.75 * 1.73 * 1.4)) ** (1 / 3.5);
    for (const mass of [0.08, 0.4, 0.8, 1, 1.25, 2, 4, 6, equalRgbAnchors, 7.99, 8, 20, 120]) {
      const ages = [...new Set([0, ...evolutionAgeBreaksGyr(mass).flatMap(age => [age, Math.max(0, age - 1e-8)])])].sort((a, b) => a - b);
      let previousMass = mass;
      for (const value of ages) {
        const star = evolve(mass, value);
        for (const n of [star.mass, star.luminosity, star.radius, star.tEff]) expect(Number.isFinite(n)).toBe(true);
        expect(star.mass).toBeLessThanOrEqual(previousMass + 1e-7);
        expect(star.mass).toBeGreaterThan(0);
        if (star.luminosity > 0) expect(star.radius ** 2 * (star.tEff / 5772) ** 4 / star.luminosity).toBeCloseTo(1, 10);
        previousMass = star.mass;
      }
      const tMs = msLifetimeGyr(mass);
      expect(evolve(mass, tMs * (1 - 1e-12)).luminosity / evolve(mass, tMs).luminosity).toBeCloseTo(1, 7);
    }
  });
});
