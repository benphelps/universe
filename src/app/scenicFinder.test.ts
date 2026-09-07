import { describe, expect, it } from 'vitest';
import { generateSystem } from '../universe/system/generate';
import { scenicSkyClarity, scenicWorlds, sceneUrl, shortlistScenes, type SceneCandidate } from './scenicFinder';

const galaxy = '53494d5f554e4956';
const fixture = () => structuredClone(generateSystem(0xd50464b00652fab0n));

describe('scenic location screening', () => {
  it('rejects edge-on ring prospects and distant parents, but retains inclined close moon views', () => {
    const system = fixture();
    const giant = system.planets.find(p => p.rings && p.moons.length)!;
    system.planets = [giant]; system.companions = [];
    giant.rings!.opticalDepth = 1; giant.rings!.albedo = 0.8;
    giant.rings!.innerPlanetRadii = 1.3; giant.rings!.outerPlanetRadii = 2.5;
    giant.moons = [giant.moons[0]];
    const moon = giant.moons[0];
    moon.physical.atmosphere.class = 'none'; moon.physical.atmosphere.surfacePressureBar = 0;
    moon.physical.appearance.clouds.coverage = 0;
    moon.physical.bulk.radiusEarth = 0.1;
    moon.semiMajorAxisPlanetRadii = 10; moon.elements.inclination = 0;
    expect(scenicWorlds(system, galaxy, 'ringed-moon')).toHaveLength(0);
    moon.elements.inclination = 0.3;
    const found = scenicWorlds(system, galaxy, 'ringed-moon');
    expect(found).toHaveLength(1);
    expect(found[0].destination.moon).toBe(0);
    moon.elements.inclination = 0.025;
    moon.semiMajorAxisPlanetRadii = 5;
    expect(scenicWorlds(system, galaxy, 'ringed-moon')).toHaveLength(1);
    moon.semiMajorAxisPlanetRadii = 100;
    expect(scenicWorlds(system, galaxy, 'ringed-moon')).toHaveLength(0);
  });

  it('requires exposed water and some land for coastline candidates', () => {
    const system = fixture();
    const planet = system.planets[6]; system.planets = [planet]; system.companions = []; planet.moons = [];
    expect(scenicWorlds(system, galaxy, 'coastline')).toHaveLength(1);
    planet.physical.climate.snowball = true;
    expect(scenicWorlds(system, galaxy, 'coastline')).toHaveLength(0);
    planet.physical.climate.snowball = false;
    planet.physical.climate.oceanCoverage = 1;
    expect(scenicWorlds(system, galaxy, 'coastline')).toHaveLength(0);
  });

  it('penalizes opaque global clouds rather than treating every atmosphere as a clear sky', () => {
    const physical = fixture().planets[6].physical;
    physical.appearance.clouds.coverage = 0;
    const clear = scenicSkyClarity(physical);
    physical.appearance.clouds.coverage = 1;
    physical.appearance.clouds.opticalDepth = 20;
    expect(scenicSkyClarity(physical)).toBeLessThan(clear * 0.01);
  });

  it('screens binary scenes by visible light rather than brown-dwarf infrared power', () => {
    const system = fixture();
    system.planets = [system.planets[6]]; system.planets[0].moons = [];
    system.configuration = 'p-type';
    system.star.tEff = 5800; system.star.luminosity = 1;
    system.companions = [{ star: { ...system.star }, elements: { ...system.planets[0].elements,
      semiMajorAxis: system.planets[0].elements.semiMajorAxis * 0.1 }, planets: [], belts: [], zones: system.zones }];
    expect(scenicWorlds(system, galaxy, 'binary')).toHaveLength(1);
    system.companions[0].star.tEff = 600;
    expect(scenicWorlds(system, galaxy, 'binary')).toHaveLength(0);
  });

  it('includes different galaxy morphologies instead of filling the list with one family', () => {
    const item = (id: string, variant: string, score: number) => ({ id, kind: 'galaxy', variant, score } as SceneCandidate);
    const found = shortlistScenes([item('a', 'grand-design', 95), item('b', 'grand-design', 94),
      item('c', 'multi-arm', 85), item('d', 'flocculent', 75)], 'galaxy', 3);
    expect(found.map(c => c.variant)).toEqual(['grand-design', 'multi-arm', 'flocculent']);
  });

  it('keeps deterministic, bounded rankings with category variety', () => {
    const system = fixture();
    const found = scenicWorlds(system, galaxy);
    expect(found.length).toBeGreaterThan(0);
    expect(scenicWorlds(system, galaxy)).toEqual(found);
    expect(found.every(c => c.score >= 0 && c.score <= 100)).toBe(true);
    const mixed = shortlistScenes([...found, ...found], 'all', 8);
    expect(mixed.length).toBeLessThanOrEqual(8);
    expect(new Set(mixed.map(c => c.id)).size).toBe(mixed.length);
    expect(new Set(mixed.map(c => c.kind)).size).toBeGreaterThan(1);
  });

  it('retains companion moon addresses and deployment paths without stale focus parameters', () => {
    const candidate = { destination: { galaxy, seed: '0123456789abcdef', planet: 2, moon: 0, companion: 1,
      positionPc: { xPc: 1.234567, yPc: -2, zPc: 3 } } } as SceneCandidate;
    const url = new URL(sceneUrl(candidate, 'https://example.com/universe/?core=1&cloud=old#stale'));
    expect(url.pathname).toBe('/universe/');
    expect(url.searchParams.get('moon')).toBe('0');
    expect(url.searchParams.get('companion')).toBe('1');
    expect(url.searchParams.get('at')).toBe('1.2346_-2.0000_3.0000');
    expect(url.searchParams.has('core')).toBe(false);
    expect(url.searchParams.has('cloud')).toBe(false);
    expect(url.hash).toBe('');
  });
});
