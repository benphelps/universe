import { describe, expect, it } from 'vitest';
import { elementsToState } from '../../core/math/kepler';
import { AU, EARTH_RADIUS, EARTH_MASS, SOLAR_MASS } from '../../core/physics/constants';
import { mu, seconds } from '../../core/physics/units';
import { generateSystem } from '../system/generate';
import { rocheLimitPlanetRadii, satelliteOuterLimitM, tidalHeatFluxWm2 } from './generate';

describe('tidal heating calibration', () => {
  it('reproduces Io around a Jupiter analog', () => {
    const flux = tidalHeatFluxWm2(318, 0.0041, 0.286, 4.22e8);
    expect(flux).toBeGreaterThan(0.5);
    expect(flux).toBeLessThan(6);
  });

  it('falls off steeply with distance', () => {
    const io = tidalHeatFluxWm2(318, 0.004, 0.28, 4.22e8);
    const callisto = tidalHeatFluxWm2(318, 0.004, 0.38, 1.88e9);
    expect(callisto).toBeLessThan(io / 100);
  });
});

describe('satellite systems', () => {
  type Sys = ReturnType<typeof generateSystem>;
  const giants: Sys['planets'] = [];
  const terrestrials: Sys['planets'] = [];
  const systems: Sys[] = [];
  for (let i = 0; i < 300; i++) {
    const system = generateSystem(BigInt(700000 + i));
    systems.push(system);
    for (const planet of system.planets) {
      if (planet.class === 'gas-giant') giants.push(planet);
      if (planet.class === 'rocky' || planet.class === 'super-earth') terrestrials.push(planet);
    }
  }

  it('giants host regular moon systems within sane mass budgets', () => {
    expect(giants.length).toBeGreaterThan(10);
    for (const giant of giants) {
      const regulars = giant.moons.filter((m) => m.channel === 'coaccretion');
      // Close-in giants can have no room for surviving satellites.
      expect(regulars.length).toBeLessThanOrEqual(6);
      const totalMass = regulars.reduce((sum, m) => sum + m.physical.bulk.massEarth, 0);
      const ratio = totalMass / giant.physical.bulk.massEarth;
      if (regulars.length) expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(3e-3);
      for (let i = 1; i < regulars.length; i++) {
        expect(regulars[i].elements.semiMajorAxis).toBeGreaterThan(
          regulars[i - 1].elements.semiMajorAxis,
        );
      }
    }
  });

  it('all formation channels fit Roche and eccentric stellar bounds, including companion hosts', () => {
    const sample = [...systems, ...[0xc77318b68a1a8910n, 0x9a0ba413e5e792dfn].map(seed => generateSystem(seed))];
    for (const system of sample) {
      const hosts = [{ planets: system.planets, mass: system.centralMassSolar },
        ...system.companions.map(c => ({ planets: c.planets, mass: c.star.mass }))];
      for (const host of hosts) for (const planet of host.planets) {
        const pericenterHill = planet.elements.semiMajorAxis * (1 - planet.elements.eccentricity) *
          Math.cbrt(planet.physical.bulk.massEarth * EARTH_MASS / (3 * host.mass * SOLAR_MASS));
        for (let i = 0; i < planet.moons.length; i++) {
          const moon = planet.moons[i];
          const { semiMajorAxis: a, eccentricity: e } = moon.elements;
          const roche = rocheLimitPlanetRadii(planet.physical.bulk.densityGcc, moon.physical.bulk.densityGcc) * planet.physical.bulk.radiusEarth * EARTH_RADIUS;
          expect(a * (1 - e)).toBeGreaterThan(roche);
          expect(a * (1 + e)).toBeLessThan(pericenterHill);
          expect(a).toBeLessThan(satelliteOuterLimitM(planet, host.mass, e, moon.retrograde));
          if (i > 0) expect(a * (1 - e)).toBeGreaterThan(planet.moons[i - 1].elements.semiMajorAxis * (1 + planet.moons[i - 1].elements.eccentricity));
          if (moon.resonanceWithInner) {
            expect(i).toBeGreaterThan(0);
            const inner = planet.moons[i - 1];
            const mass = planet.physical.bulk.massEarth;
            const ratio = (a / inner.elements.semiMajorAxis) ** 1.5 * Math.sqrt((mass + inner.physical.bulk.massEarth) / (mass + moon.physical.bulk.massEarth));
            expect(ratio).toBeCloseTo(2, 9);
          }
        }
      }
    }
  });

  it('no regular moon orbits inside its Roche limit', () => {
    for (const planet of [...giants, ...terrestrials]) {
      const roche =
        rocheLimitPlanetRadii(planet.physical.bulk.densityGcc, 1.8) *
        planet.physical.bulk.radiusEarth *
        EARTH_RADIUS;
      for (const moon of planet.moons) {
        if (moon.channel === 'capture') continue;
        expect(moon.elements.semiMajorAxis).toBeGreaterThan(roche);
      }
    }
  });

  it('impact moons appear around a fraction of terrestrials, receded with age', () => {
    const withImpactMoon = terrestrials.filter((p) =>
      p.moons.some((m) => m.channel === 'impact'),
    );
    expect(withImpactMoon.length).toBeGreaterThan(0);
    for (const planet of withImpactMoon) {
      const moon = planet.moons.find((m) => m.channel === 'impact')!;
      expect(moon.semiMajorAxisPlanetRadii).toBeGreaterThan(14);
      expect(moon.semiMajorAxisPlanetRadii).toBeLessThan(80);
      expect(moon.physical.rotation.locked).toBe(true);
    }
  });

  it('tidally active moons exist: volcanic or ocean-bearing states', () => {
    const states = new Set<string>();
    for (const giant of giants) {
      for (const moon of giant.moons) states.add(moon.tidalState);
    }
    expect(states.has('dead')).toBe(true);
    const active = ['volcanic', 'cryovolcanic', 'subsurface-ocean'].some((s) => states.has(s));
    expect(active).toBe(true);
  });

  it('ring systems: some are Saturn-class, gaps sit at moon resonances', () => {
    let ringed = 0;
    let saturnClass = 0;
    let gapChecked = false;
    for (const giant of giants) {
      if (!giant.rings) continue;
      ringed++;
      if (giant.rings.opticalDepth > 0.4) saturnClass++;
      expect(giant.rings.innerPlanetRadii).toBeGreaterThan(1);
      // Degenerate super-giants (ρ ≈ 10 g/cc) push the Roche limit far out.
      expect(giant.rings.outerPlanetRadii).toBeLessThan(6);
      const planetRadiusM = giant.physical.bulk.radiusEarth * EARTH_RADIUS;
      for (const gap of giant.rings.gaps) {
        const [p, q] = gap.resonance.split(':').map(Number);
        const match = giant.moons.some((moon) => {
          const moonRadii = moon.elements.semiMajorAxis / planetRadiusM;
          return Math.abs(moonRadii * (q / p) ** (2 / 3) - gap.radiusPlanetRadii) < 1e-6;
        });
        expect(match).toBe(true);
        gapChecked = true;
      }
    }
    expect(ringed).toBeGreaterThan(3);
    expect(saturnClass).toBeGreaterThan(0);
    expect(gapChecked).toBe(true);
  });

  it('comets: bound candidate orbits do not guarantee an active apparition', () => {
    const anyMu = mu(1.327e20);
    let inactive = 0;
    for (const system of systems.slice(0, 30)) {
      expect(system.comets.length).toBeGreaterThan(0);
      const first = system.comets[0];
      const { position } = elementsToState(first.elements, anyMu, seconds(0));
      const rAu = Math.hypot(position.x, position.y, position.z) / AU;
      if (rAu >= first.activityOnsetAu) inactive++;
      for (const comet of system.comets) {
        expect(comet.elements.eccentricity).toBeGreaterThan(0.8);
        expect(comet.elements.eccentricity).toBeLessThan(1);
      }
    }
    expect(inactive).toBeGreaterThan(0);
  });

  it('moon generation is deterministic', () => {
    const a = generateSystem(700123n);
    const b = generateSystem(700123n);
    expect(JSON.stringify(a.planets.map((p) => p.moons))).toBe(
      JSON.stringify(b.planets.map((p) => p.moons)),
    );
  });
});
