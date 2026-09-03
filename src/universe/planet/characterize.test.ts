import { mu } from '../../core/physics/units';
import { describe, expect, it } from 'vitest';
import { AU, G, SOLAR_MASS } from '../../core/physics/constants';
import { generateStar } from '../star/generate';
import { generateSystem } from '../system/generate';
import { computeZones } from '../system/zones';
import { characterizePlanet, type CharacterizeContext } from './characterize';
import type { PlanetClass } from '../system/types';

const SUN = generateStar(1n, { massInitial: 1, ageGyr: 4.6, feH: 0, withCompanions: false });
const SUN_CONTEXT: CharacterizeContext = {
  star: SUN,
  centralLuminosity: SUN.luminosity,
  mu: mu(G * SOLAR_MASS),
  zones: computeZones(SUN.luminosity, SUN.tEff, SUN.ageGyr, 1),
};

function fixture(
  seed: bigint,
  planetClass: PlanetClass,
  massEarth: number,
  aAu: number,
  context = SUN_CONTEXT,
) {
  return characterizePlanet(
    seed,
    planetClass,
    massEarth,
    {
      semiMajorAxis: aAu * AU,
      eccentricity: 0.02,
      inclination: 0,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    },
    context,
  );
}

describe('planet fixtures around a Sun-like star', () => {
  it('an Earth analog is temperate with oceans', () => {
    const earth = fixture(11n, 'rocky', 1, 1);
    expect(earth.bulk.radiusEarth).toBeGreaterThan(0.85);
    expect(earth.bulk.radiusEarth).toBeLessThan(1.15);
    expect(earth.climate.surfaceMeanK).toBeGreaterThan(255);
    expect(earth.climate.surfaceMeanK).toBeLessThan(330);
    expect(earth.climate.hydrosphere).toBe('oceans');
    expect(earth.rotation.locked).toBe(false);
    expect(earth.atmosphere.surfacePressureBar).toBeGreaterThan(0.1);
    expect(earth.interior.magneticFieldRelEarth).toBeGreaterThan(0);
  });

  it('a Venus analog runs away into a hothouse', () => {
    const venus = fixture(12n, 'rocky', 0.815, 0.72);
    expect(venus.atmosphere.class).toBe('co2-hothouse');
    expect(venus.atmosphere.surfacePressureBar).toBeGreaterThan(10);
    expect(venus.climate.surfaceMeanK).toBeGreaterThan(500);
    expect(venus.climate.hydrosphere).not.toBe('oceans');
    expect(venus.appearance.clouds.coverage).toBe(1);
    expect(venus.appearance.clouds.condensate).toBe('sulfuric-acid');
  });

  it('a close-in eccentric rocky world melts into bounded magma seas', () => {
    const lava = characterizePlanet(
      13n,
      'rocky',
      0.9,
      {
        semiMajorAxis: 0.035 * AU,
        eccentricity: 0.05,
        inclination: 0,
        longitudeOfAscendingNode: 0,
        argumentOfPeriapsis: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
      },
      SUN_CONTEXT,
    );
    expect(lava.interior.regime).toBe('magma');
    expect(lava.climate.hydrosphere).toBe('magma');
    expect(lava.climate.oceanCoverage).toBeGreaterThanOrEqual(0.05);
    expect(lava.climate.oceanCoverage).toBeLessThanOrEqual(0.95);
    expect(lava.appearance.lavaGlow).toBe(1);
  });

  it('a Mars analog is a cold thin-atmosphere world', () => {
    const mars = fixture(13n, 'rocky', 0.107, 1.52);
    expect(['thin-co2', 'none']).toContain(mars.atmosphere.class);
    expect(mars.atmosphere.surfacePressureBar).toBeLessThan(0.3);
    expect(mars.climate.surfaceMeanK).toBeLessThan(270);
    expect(mars.climate.hydrosphere).not.toBe('oceans');
  });

  it('a Jupiter analog is a cold banded giant', () => {
    const jupiter = fixture(14n, 'gas-giant', 318, 5.2);
    expect(jupiter.bulk.radiusEarth).toBeGreaterThan(10);
    expect(jupiter.bulk.radiusEarth).toBeLessThan(12.5);
    expect(jupiter.climate.equilibriumK).toBeGreaterThan(90);
    expect(jupiter.climate.equilibriumK).toBeLessThan(140);
    expect(jupiter.appearance.banding).not.toBeNull();
    expect(jupiter.appearance.banding!.bandCount).toBeGreaterThanOrEqual(7);
    expect(jupiter.appearance.banding!.thermalGlowK).toBe(0);
    expect(jupiter.interior.magneticFieldRelEarth).toBeGreaterThan(5);
  });

  it('a Uranus analog gets the methane teal palette', () => {
    const uranus = fixture(15n, 'ice-giant', 14.5, 19.2);
    const banding = uranus.appearance.banding!;
    expect(banding.zoneColor[2]).toBeGreaterThan(banding.zoneColor[0]);
    expect(uranus.climate.equilibriumK).toBeLessThan(90);
  });

  it('a hot Jupiter is inflated and thermally glowing', () => {
    const hot = fixture(16n, 'gas-giant', 400, 0.05);
    expect(hot.bulk.radiusEarth).toBeGreaterThan(11.8);
    expect(hot.appearance.banding!.thermalGlowK).toBeGreaterThan(900);
  });
});

describe('locked worlds', () => {
  it('an M-dwarf habitable-zone planet is locked with a day-night contrast', () => {
    const mDwarf = generateStar(2n, { massInitial: 0.2, ageGyr: 5, feH: 0, withCompanions: false });
    const context: CharacterizeContext = {
      star: mDwarf,
      centralLuminosity: mDwarf.luminosity,
      mu: mu(G * 0.2 * SOLAR_MASS),
      zones: computeZones(mDwarf.luminosity, mDwarf.tEff, mDwarf.ageGyr, 0.2),
    };
    const planet = fixture(17n, 'rocky', 1, context.zones.habitableInnerAu * 1.05, context);
    expect(planet.rotation.locked).toBe(true);
    expect(planet.rotation.periodHours).toBeGreaterThan(24 * 5);
  });
});

describe('population statistics', () => {
  it('systems contain the expected diversity of outcomes', () => {
    let oceans = 0;
    let hothouses = 0;
    let snowballs = 0;
    let biospheres = 0;
    let airless = 0;
    let magnetic = 0;
    let total = 0;
    for (let i = 0; i < 250; i++) {
      const system = generateSystem(BigInt(500000 + i));
      for (const planet of system.planets) {
        total++;
        const { climate, atmosphere, interior } = planet.physical;
        if (climate.hydrosphere === 'oceans') oceans++;
        if (atmosphere.class === 'co2-hothouse') hothouses++;
        if (climate.snowball) snowballs++;
        if (climate.biosphere) biospheres++;
        if (atmosphere.class === 'none') airless++;
        if (interior.magneticFieldRelEarth > 0.1) magnetic++;
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(oceans).toBeGreaterThan(0);
    expect(hothouses).toBeGreaterThan(0);
    expect(snowballs).toBeGreaterThan(0);
    expect(biospheres).toBeGreaterThan(0);
    expect(airless).toBeGreaterThan(0);
    expect(magnetic).toBeGreaterThan(0);
    // Ocean worlds are special, not the norm.
    expect(oceans / total).toBeLessThan(0.3);
  });

  it('characterization is deterministic', () => {
    const a = fixture(99n, 'super-earth', 4, 1.1);
    const b = fixture(99n, 'super-earth', 4, 1.1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
