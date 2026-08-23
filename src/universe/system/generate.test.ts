import { describe, expect, it } from 'vitest';
import { AU } from '../../core/physics/constants';
import { mutualHillFactor } from './architecture';
import { resonanceSemiMajorAxisAu } from './belts';
import { generateSystem } from './generate';
import { pTypeCriticalAu, sTypeCriticalAu } from './holmanWiegert';
import { computeZones } from './zones';

describe('zones', () => {
  it('solar values reproduce the Kopparapu habitable zone and frost line', () => {
    const zones = computeZones(1, 5772, 4.6, 1);
    expect(zones.habitableInnerAu).toBeGreaterThan(0.9);
    expect(zones.habitableInnerAu).toBeLessThan(1.0);
    expect(zones.habitableOuterAu).toBeGreaterThan(1.6);
    expect(zones.habitableOuterAu).toBeLessThan(1.75);
    expect(zones.frostLineAu).toBeCloseTo(2.7, 1);
    // Mercury (0.39 AU) must remain unlocked around the Sun.
    expect(zones.tidalLockAu).toBeLessThan(0.39);
  });

  it('an M-dwarf habitable zone lies inside its tidal-lock radius', () => {
    const zones = computeZones(0.006, 3050, 5, 0.15);
    expect(zones.habitableInnerAu).toBeLessThan(0.1);
    expect(zones.tidalLockAu).toBeGreaterThan(zones.habitableInnerAu);
  });
});

describe('Kirkwood arithmetic', () => {
  it('a Jupiter at 5.2 AU carves gaps at the observed radii', () => {
    expect(resonanceSemiMajorAxisAu(5.2, 3, 1)).toBeCloseTo(2.5, 1);
    expect(resonanceSemiMajorAxisAu(5.2, 5, 2)).toBeCloseTo(2.82, 1);
    expect(resonanceSemiMajorAxisAu(5.2, 7, 3)).toBeCloseTo(2.96, 1);
    expect(resonanceSemiMajorAxisAu(5.2, 2, 1)).toBeCloseTo(3.28, 1);
  });
});

describe('Holman–Wiegert limits', () => {
  it('matches published solar-mass equal-binary values', () => {
    // Equal-mass circular binary: S-type ≈ 0.27 a_bin, P-type ≈ 2.3 a_bin.
    expect(sTypeCriticalAu(1, 0, 0.5) / 1).toBeCloseTo(0.27, 1);
    expect(pTypeCriticalAu(1, 0, 0.5) / 1).toBeCloseTo(2.3, 0);
    // Eccentricity shrinks the S-type region and pushes the P-type limit out.
    expect(sTypeCriticalAu(1, 0.5, 0.5)).toBeLessThan(sTypeCriticalAu(1, 0, 0.5));
    expect(pTypeCriticalAu(1, 0.5, 0.5)).toBeGreaterThan(pTypeCriticalAu(1, 0, 0.5));
  });
});

describe('generateSystem', () => {
  it('is deterministic', () => {
    const a = generateSystem(0xabcdef12n);
    const b = generateSystem(0xabcdef12n);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('every emitted system passes the stability spacing rule', () => {
    for (let i = 0; i < 200; i++) {
      const system = generateSystem(BigInt(9000 + i));
      const planets = system.planets;
      for (let j = 0; j + 1 < planets.length; j++) {
        const aInner = planets[j].elements.semiMajorAxis / AU;
        const aOuter = planets[j + 1].elements.semiMajorAxis / AU;
        expect(aOuter).toBeGreaterThan(aInner);
        const hillAu =
          mutualHillFactor(
            planets[j].physical.bulk.massEarth,
            planets[j + 1].physical.bulk.massEarth,
            system.centralMassSolar,
          ) *
          ((aInner + aOuter) / 2);
        expect((aOuter - aInner) / hillAu).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('orbits stay bounded and non-crossing', () => {
    for (let i = 0; i < 200; i++) {
      const system = generateSystem(BigInt(40000 + i));
      for (let j = 0; j + 1 < system.planets.length; j++) {
        const inner = system.planets[j].elements;
        const outer = system.planets[j + 1].elements;
        expect(inner.eccentricity).toBeLessThan(0.86);
        const innerApo = (inner.semiMajorAxis / AU) * (1 + inner.eccentricity);
        const outerPeri = (outer.semiMajorAxis / AU) * (1 - outer.eccentricity);
        expect(outerPeri).toBeGreaterThan(innerApo);
      }
    }
  });

  it('most main-sequence stars host planets; giants are a minority', () => {
    let withPlanets = 0;
    let withGiant = 0;
    let mainSequence = 0;
    for (let i = 0; i < 300; i++) {
      const system = generateSystem(BigInt(70000 + i));
      if (system.star.stage !== 'main-sequence') continue;
      mainSequence++;
      if (system.planets.length > 0) withPlanets++;
      if (system.planets.some((p) => p.class === 'gas-giant')) withGiant++;
    }
    expect(withPlanets / mainSequence).toBeGreaterThan(0.7);
    expect(withGiant / mainSequence).toBeGreaterThan(0.02);
    expect(withGiant / mainSequence).toBeLessThan(0.45);
  });

  it('supernova remnants have sterile systems; white dwarfs lose close planets', () => {
    for (let i = 0; i < 400; i++) {
      const system = generateSystem(BigInt(110000 + i));
      const stage = system.star.stage;
      if (stage === 'neutron-star' || stage === 'black-hole') {
        expect(system.planets).toHaveLength(0);
      }
      if (stage === 'white-dwarf') {
        for (const planet of system.planets) {
          expect(planet.elements.semiMajorAxis / AU).toBeGreaterThan(1);
        }
      }
    }
  });

  it('p-type systems keep planets outside the circumbinary critical radius', () => {
    let pTypeSeen = 0;
    for (let i = 0; i < 600 && pTypeSeen < 3; i++) {
      const system = generateSystem(BigInt(150000 + i));
      if (system.configuration !== 'p-type') continue;
      pTypeSeen++;
      const binary = system.companions[0];
      const aBin = binary.elements.semiMajorAxis / AU;
      const mu = binary.star.mass / (system.star.mass + binary.star.mass);
      const critical = pTypeCriticalAu(aBin, binary.elements.eccentricity, mu);
      for (const planet of system.planets) {
        expect(planet.elements.semiMajorAxis / AU).toBeGreaterThan(critical);
      }
    }
    expect(pTypeSeen).toBeGreaterThan(0);
  });

  it('belt gaps sit at resonances of the innermost giant', () => {
    let beltsSeen = 0;
    for (let i = 0; i < 400 && beltsSeen < 5; i++) {
      const system = generateSystem(BigInt(200000 + i));
      const belt = system.belts.find((b) => b.kind === 'main');
      const giant = system.planets.find((p) => p.class === 'gas-giant');
      if (!belt || !giant || belt.gaps.length === 0) continue;
      beltsSeen++;
      const aGiant = giant.elements.semiMajorAxis / AU;
      for (const gap of belt.gaps) {
        const [p, q] = gap.resonance.split(':').map(Number);
        expect(gap.semiMajorAxisAu).toBeCloseTo(aGiant * (q / p) ** (2 / 3), 3);
      }
    }
    expect(beltsSeen).toBeGreaterThan(0);
  });

  it('metal-rich stars host giant planets more often', () => {
    // Metallicity is drawn per-seed; compare the high- and low-feH halves.
    let richGiants = 0;
    let richCount = 0;
    let poorGiants = 0;
    let poorCount = 0;
    for (let i = 0; i < 1500; i++) {
      const system = generateSystem(BigInt(300000 + i));
      if (system.star.stage !== 'main-sequence' || system.star.massInitial < 0.4) continue;
      const hasGiant = system.planets.some((p) => p.class === 'gas-giant') ? 1 : 0;
      if (system.star.feH > 0.08) {
        richCount++;
        richGiants += hasGiant;
      } else if (system.star.feH < -0.08) {
        poorCount++;
        poorGiants += hasGiant;
      }
    }
    expect(richCount).toBeGreaterThan(15);
    expect(poorCount).toBeGreaterThan(15);
    expect(richGiants / richCount).toBeGreaterThan(poorGiants / poorCount);
  });
});
