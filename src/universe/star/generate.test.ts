import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng/rng';
import { generateStar } from './generate';
import { PROPER_NAME_LUMINOSITY, starDesignation } from './naming';
import { sampleInitialMass } from './imf';
import { luminosityMultiplierAt } from './variability';

describe('star fixtures', () => {
  it('Sun-like inputs reproduce the Sun', () => {
    const star = generateStar(1n, { massInitial: 1, ageGyr: 4.6, feH: 0, withCompanions: false });
    expect(star.stage).toBe('main-sequence');
    expect(star.luminosity).toBeGreaterThan(0.9);
    expect(star.luminosity).toBeLessThan(1.1);
    expect(star.radius).toBeGreaterThan(0.93);
    expect(star.radius).toBeLessThan(1.07);
    expect(star.tEff).toBeGreaterThan(5650);
    expect(star.tEff).toBeLessThan(5950);
    expect(star.spectralType).toMatch(/^G[1-3]V$/);
    expect(star.chromaticity.x).toBeCloseTo(0.327, 1);
  });

  it('low-mass star is a cool red M dwarf', () => {
    const star = generateStar(2n, { massInitial: 0.2, ageGyr: 5, feH: 0, withCompanions: false });
    expect(star.stage).toBe('main-sequence');
    expect(star.spectralType).toMatch(/^M\dV$/);
    expect(star.tEff).toBeLessThan(3700);
    expect(star.linearRgb[0]).toBeGreaterThan(star.linearRgb[2]);
    expect(star.activity.flareRatePerDay).toBeGreaterThan(0.1);
  });

  it('massive star near end of life is a red supergiant', () => {
    const star = generateStar(3n, {
      massInitial: 18,
      ageGyr: 0.00595,
      feH: 0,
      withCompanions: false,
    });
    expect(star.stage).toBe('supergiant');
    expect(star.radius).toBeGreaterThan(200);
    expect(star.tEff).toBeLessThan(5000);
    expect(star.spectralType).toMatch(/^[KM]\dI$/);
  });

  it('old solar-mass star has become a white dwarf', () => {
    const star = generateStar(4n, { massInitial: 1, ageGyr: 12, feH: 0, withCompanions: false });
    expect(star.stage).toBe('white-dwarf');
    expect(star.mass).toBeCloseTo(0.5, 1);
    expect(star.radius).toBeLessThan(0.02);
    expect(star.tEff).toBeGreaterThan(8000);
    expect(star.tEff).toBeLessThan(25000);
    expect(star.spectralType).toMatch(/^DA\d$/);
    expect(star.activity.spotCoverage).toBe(0);
    expect(star.activity.differentialRotation).toBe(0);
    expect(star.activity.flareRatePerDay).toBe(0);
  });

  it('substellar mass is a brown dwarf with L/T/Y classing', () => {
    const star = generateStar(5n, { massInitial: 0.05, ageGyr: 1, feH: 0, withCompanions: false });
    expect(star.stage).toBe('brown-dwarf');
    expect(star.spectralType).toMatch(/^[LTY]\d$/);
    expect(star.luminosity).toBeLessThan(0.001);
  });
});

describe('determinism', () => {
  it('same seed yields a deep-equal star, including companions', () => {
    const a = generateStar(0xdeadbeefn);
    const b = generateStar(0xdeadbeefn);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('variability multiplier is deterministic in t', () => {
    const star = generateStar(6n, { massInitial: 0.2, ageGyr: 1, withCompanions: false });
    for (const t of [0, 12.3, 456.78]) {
      expect(luminosityMultiplierAt(star, t)).toBe(luminosityMultiplierAt(star, t));
    }
  });
});

describe('population statistics', () => {
  it('IMF sampling is M-dwarf dominated among stellar masses', () => {
    const rng = new Rng(7n);
    let mCount = 0;
    let stellar = 0;
    for (let i = 0; i < 10000; i++) {
      const m = sampleInitialMass(rng);
      if (m < 0.08) continue;
      stellar++;
      if (m < 0.5) mCount++;
    }
    const fraction = mCount / stellar;
    expect(fraction).toBeGreaterThan(0.55);
    expect(fraction).toBeLessThan(0.9);
  });

  it('a random field population contains dwarfs, evolved stars, and remnants', () => {
    const stages = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const star = generateStar(BigInt(1000 + i), { withCompanions: false });
      stages.set(star.stage, (stages.get(star.stage) ?? 0) + 1);
    }
    expect(stages.get('main-sequence') ?? 0).toBeGreaterThan(1500);
    expect(stages.get('white-dwarf') ?? 0).toBeGreaterThan(0);
    expect(stages.get('brown-dwarf') ?? 0).toBeGreaterThan(0);
    const evolved =
      (stages.get('giant') ?? 0) + (stages.get('subgiant') ?? 0) + (stages.get('agb') ?? 0);
    expect(evolved).toBeGreaterThan(0);
  });

  it('solar-type multiplicity fraction is near 45%', () => {
    let withCompanion = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const star = generateStar(BigInt(50000 + i), { massInitial: 1, ageGyr: 4 });
      if (star.companions.length > 0) withCompanion++;
    }
    expect(withCompanion / n).toBeGreaterThan(0.35);
    expect(withCompanion / n).toBeLessThan(0.55);
  });
});

describe('designations', () => {
  it('layer proper names over sector catalog numbers', () => {
    const locale = { xPc: -7920, yPc: 7086, zPc: 12 };
    // The luminous carry proper names; the bulk file into the sector.
    expect(starDesignation(11n, locale, PROPER_NAME_LUMINOSITY * 2)).toMatch(/^[A-Z][a-z]+$/);
    const faint = starDesignation(11n, locale, 0.01);
    expect(faint).toMatch(/^[A-Z][a-z]+ [0-9A-Z]{1,4}$/);
    // Deterministic, and the catalog prefix is the star's own sector.
    expect(starDesignation(11n, locale, 0.01)).toBe(faint);

    const star = generateStar(7n, { localePc: locale, massInitial: 0.5, ageGyr: 3 });
    expect(star.designation).toMatch(/^[A-Z][a-z]+ [0-9A-Z]{1,4}$/);
    for (let i = 0; i < star.companions.length; i++) {
      expect(star.companions[i].star.designation).toBe(
        `${star.designation} ${'BCDEFGH'[i]}`,
      );
    }
  });
});
