import { describe, expect, it } from 'vitest';
import { AU } from '../core/physics/constants';
import { generateSystem } from '../universe/system/generate';
import { scenicDaylight, scenicLightScore } from './scenicLighting';
import { scenicWorlds } from './scenicFinder';

const galaxy = '53494d5f554e4956';
function fixture() {
  const system = structuredClone(generateSystem(0xd50464b00652fab0n));
  system.planets = [system.planets[6]];
  system.planets[0].moons = [];
  system.companions = []; system.configuration = 'single';
  system.star.luminosity = 1; system.star.tEff = 5772;
  system.planets[0].elements.semiMajorAxis = AU;
  system.planets[0].elements.eccentricity = 0;
  return system;
}

describe('scenic illumination', () => {
  it('matches Earth sunlight and the inverse-square law in a circular orbit', () => {
    const system = fixture();
    const planet = system.planets[0];
    const earth = scenicDaylight(system, 0, planet);
    expect(earth.meanEarth).toBeCloseTo(1, 10);
    expect(earth.minimumEarth).toBeCloseTo(1, 10);
    planet.elements.semiMajorAxis = 2 * AU;
    expect(scenicDaylight(system, 0, planet).meanEarth).toBeCloseTo(0.25, 10);
    system.star.luminosity = 0.1;
    expect(scenicDaylight(system, 0, planet).meanEarth).toBeCloseTo(0.025, 10);
  });

  it('reports changing light around an eccentric orbit without using periastron as constant daylight', () => {
    const system = fixture();
    system.planets[0].elements.eccentricity = 0.6;
    const light = scenicDaylight(system, 0, system.planets[0]);
    expect(light.maximumEarth / light.minimumEarth).toBeGreaterThan(5);
    expect(light.meanEarth).toBeLessThan(light.maximumEarth);
    expect(light.meanEarth).toBeGreaterThan(light.minimumEarth);
  });

  it('includes companions at their actual relative paths for either host', () => {
    const system = fixture();
    const planet = system.planets[0];
    system.companions = [{ star: { ...system.star }, elements: { ...planet.elements, semiMajorAxis: 100 * AU }, planets: [planet], belts: [], zones: system.zones }];
    system.configuration = 's-type';
    const primary = scenicDaylight(system, 0, planet);
    const secondary = scenicDaylight(system, 1, planet);
    expect(primary.sourcesEarth[0]).toBeCloseTo(1, 10);
    expect(secondary.sourcesEarth[1]).toBeCloseTo(1, 10);
    expect(primary.sourcesEarth[1]).toBeGreaterThan(0);
    expect(secondary.sourcesEarth[0]).toBeGreaterThan(0);
    expect(primary.meanEarth).toBeCloseTo(primary.sourcesEarth[0] + primary.sourcesEarth[1], 10);
  });

  it('penalizes dim reflected scenery and rejects infrared-only illumination', () => {
    const system = fixture();
    const bright = scenicWorlds(system, galaxy, 'coastline')[0];
    system.star.luminosity = 0.01;
    const dim = scenicWorlds(system, galaxy, 'coastline')[0];
    expect(bright.score).toBeGreaterThan(dim.score);
    system.star.luminosity = 1; system.star.tEff = 600;
    expect(scenicDaylight(system, 0, system.planets[0]).meanEarth).toBeLessThan(1e-6);
    expect(scenicWorlds(system, galaxy, 'coastline')).toHaveLength(0);
    expect(scenicLightScore(100)).toBe(scenicLightScore(1));
  });

  it('retains visibly glowing lava without sunlight but rejects infrared-only heat', () => {
    const system = fixture();
    system.star.luminosity = 0;
    const climate = system.planets[0].physical.climate;
    climate.hydrosphere = 'magma'; climate.oceanCoverage = 0.2; climate.magmaTemperatureK = 1800;
    expect(scenicWorlds(system, galaxy, 'lava')).toHaveLength(1);
    climate.magmaTemperatureK = 300;
    expect(scenicWorlds(system, galaxy, 'lava')).toHaveLength(0);
  });
});
