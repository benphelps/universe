import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS } from '../../core/physics/constants';
import { generateSystem } from '../system/generate';
import { rocheLimitPlanetRadii, tidalHeatFluxWm2 } from './generate';

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
      expect(regulars.length).toBeGreaterThanOrEqual(2);
      expect(regulars.length).toBeLessThanOrEqual(6);
      const totalMass = regulars.reduce((sum, m) => sum + m.physical.bulk.massEarth, 0);
      const ratio = totalMass / giant.physical.bulk.massEarth;
      expect(ratio).toBeGreaterThan(1e-6);
      expect(ratio).toBeLessThan(3e-3);
      for (let i = 1; i < regulars.length; i++) {
        expect(regulars[i].elements.semiMajorAxis).toBeGreaterThan(
          regulars[i - 1].elements.semiMajorAxis,
        );
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

  it('comets: every system has one near perihelion, on bound near-parabolic orbits', () => {
    for (const system of systems.slice(0, 30)) {
      expect(system.comets.length).toBeGreaterThan(0);
      const first = system.comets[0];
      expect(Math.abs(first.elements.meanAnomalyAtEpoch)).toBeLessThan(0.1);
      for (const comet of system.comets) {
        expect(comet.elements.eccentricity).toBeGreaterThan(0.8);
        expect(comet.elements.eccentricity).toBeLessThan(1);
      }
    }
  });

  it('moon generation is deterministic', () => {
    const a = generateSystem(700123n);
    const b = generateSystem(700123n);
    expect(JSON.stringify(a.planets.map((p) => p.moons))).toBe(
      JSON.stringify(b.planets.map((p) => p.moons)),
    );
  });
});
