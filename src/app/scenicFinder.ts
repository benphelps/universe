import type { GalacticPosition } from '../universe/galaxy/density';
import type { StarSystem } from '../universe/system/types';
import type { Characterization } from '../universe/planet/types';
import { AU } from '../core/physics/constants';
import { scenicDaylight, scenicLightScore, scenicLightNote, scenicLavaEmission, MIN_SCENIC_REFLECTED_LIGHT } from './scenicLighting';
import { fmt } from './ui/format';

export const SCENE_TYPES = {
  'ringed-moon': 'Ringed planet from a moon',
  coastline: 'Twilight coastline',
  binary: 'Binary-star sky',
  rings: 'Ringed planetary crescent',
  nebula: 'Luminous nebula & dust',
  galaxy: 'Spiral galaxy portrait',
  lava: 'Lava at the terminator',
  nucleus: 'Active galactic nucleus',
} as const;
export type SceneKind = keyof typeof SCENE_TYPES;
export type SceneFilter = SceneKind | 'all';
export interface SceneCandidate {
  id: string;
  kind: SceneKind;
  name: string;
  score: number;
  variant?: string;
  reasons: string[];
  framing: string;
  destination: {
    galaxy: string; seed: string; positionPc?: GalacticPosition;
    planet?: number; moon?: number; companion?: number;
    cloud?: string; core?: boolean;
  };
}
export interface SceneProgress { checked: number; total: number; stage: string }

const clamp = (v: number) => Math.max(0, Math.min(1, v));
/** A visual screening heuristic, not a radiative-transfer or weather forecast. */
export function scenicSkyClarity(p: Characterization): number {
  const haze = p.atmosphere.class === 'co2-hothouse' ? 0.08
    : p.atmosphere.class === 'nitrogen-methane' ? 0.3 : 1;
  const cloud = p.appearance.clouds;
  return clamp(haze * (1 - cloud.coverage * (1 - Math.exp(-cloud.opticalDepth))) /
    (1 + Math.max(0, p.atmosphere.surfacePressureBar - 2) * 0.4));
}

/** Cheap physical screening: no terrain surveys, portraits, or climate cycles. */
export function scenicWorlds(system: StarSystem, galaxy: string, filter: SceneFilter = 'all'): SceneCandidate[] {
  const found: SceneCandidate[] = [];
  const hosts = [{ star: system.star, planets: system.planets }, ...system.companions];
  for (const [hostIndex, host] of hosts.entries()) for (const [planetIndex, planet] of host.planets.entries()) {
    const daylight = scenicDaylight(system, hostIndex, planet);
    const lightingNote = scenicLightNote(daylight);
    const litScore = (merit: number, light: number) => 0.65 * merit + 0.35 * scenicLightScore(light);
    const destination = { galaxy, seed: system.seedHex, positionPc: system.localePc, companion: hostIndex, planet: planetIndex };
    const add = (kind: SceneKind, name: string, score: number, reasons: string[], framing: string, moon?: number) => {
      if (filter !== 'all' && filter !== kind) return;
      found.push({ id: `${system.seedHex}:${hostIndex}:${planetIndex}:${moon ?? -1}:${kind}`, kind, name,
        score: Math.round(clamp(score) * 100), reasons, framing, destination: { ...destination, moon } });
    };
    const rings = planet.rings;
    // A crescent returns only a fraction of the incident light; ring orientation
    // and shadows still need a camera/time choice.
    const ringLight = daylight.meanEarth * (rings?.albedo ?? 0) * 0.15;
    const ringStrength = rings ? clamp(rings.albedo * (1 - Math.exp(-rings.opticalDepth)) *
      (rings.outerPlanetRadii - rings.innerPlanetRadii)) : 0;
    if (rings && ringStrength > 0.08 && ringLight >= MIN_SCENIC_REFLECTED_LIGHT) {
      add('rings', planet.name, litScore(0.5 + 0.4 * ringStrength + 0.1 * Number(!!planet.physical.appearance.banding), ringLight),
        [`${rings.composition} rings · ${fmt(rings.outerPlanetRadii)} planet radii`, `${rings.gaps.length} ring gaps`, lightingNote],
        'Orbit toward the night side for a crescent; tilt above the ring plane to reveal its width.');
      for (const [moonIndex, moon] of planet.moons.entries()) {
        const distance = moon.semiMajorAxisPlanetRadii;
        const diameter = 2 * Math.asin(Math.min(1, 1 / distance)) * 180 / Math.PI;
        // Co-planar close moons usually see a thin line. Inclination and surface
        // parallax bound the opening available somewhere along this moon’s orbit.
        const opening = (Math.asin(Math.abs(Math.sin(moon.elements.inclination))) +
          Math.atan(moon.physical.bulk.radiusEarth / planet.physical.bulk.radiusEarth / distance)) * 180 / Math.PI;
        const ringHeight = 2 * Math.asin(Math.min(1, rings.outerPlanetRadii / distance)) * 180 / Math.PI * Math.sin(opening * Math.PI / 180);
        const clarity = scenicSkyClarity(moon.physical);
        // A narrow opening can still resolve around a very large parent. Require
        // angular thickness rather than rejecting all nearly equatorial moons.
        if (diameter >= 3 && ringHeight >= 0.15 && clarity > 0.25 && moon.physical.bulk.radiusEarth > 0.03 && ringLight * clarity >= MIN_SCENIC_REFLECTED_LIGHT) {
          add('ringed-moon', moon.name, litScore(0.25 * ringStrength + 0.3 * clamp(diameter / 15) + 0.25 * clarity + 0.2 * clamp(opening / 20), ringLight * clarity),
            [`Parent ≈ ${fmt(diameter, 2)}° across at orbital radius`, `Up to ≈ ${fmt(opening, 2)}° ring opening · clear-sky potential`, lightingNote],
            'Descend on the parent-facing hemisphere. Choose an orbital phase that opens the rings, then put the parent above the terrain horizon.', moonIndex);
        }
      }
    }
    for (const [index, body] of [planet, ...planet.moons].entries()) {
      const moon = index === 0 ? undefined : index - 1;
      const p = body.physical;
      const clarity = scenicSkyClarity(p);
      const coverage = p.climate.oceanCoverage;
      const surfaceLight = daylight.meanEarth * clarity * Math.max(0, p.climate.bondAlbedo);
      const lavaLight = p.climate.hydrosphere === 'magma'
        ? scenicLavaEmission(p.climate.magmaTemperatureK ?? 1800, p.climate.bondAlbedo) * clarity : 0;
      const solid = p.atmosphere.class !== 'hydrogen-helium';
      if (solid && p.climate.hydrosphere === 'oceans' && !p.climate.snowball && coverage > 0.05 && coverage < 0.92 &&
          p.atmosphere.surfacePressureBar >= 0.03 && clarity > 0.25 && surfaceLight >= MIN_SCENIC_REFLECTED_LIGHT) {
        add('coastline', body.name, litScore(0.45 * clarity + 0.35 * (1 - Math.abs(coverage - 0.5)) + 0.2 * clamp(p.appearance.clouds.coverage / 0.5), surfaceLight),
          [`${Math.round(coverage * 100)}% water basins · land remains`, `${fmt(p.atmosphere.surfacePressureBar)} bar · ${Math.round(p.appearance.clouds.coverage * 100)}% cloud cover`, lightingNote],
          'Find a shoreline from orbit, descend, and frame a low sun. Exact shorelines and local cloud cover need visual scouting.', moon);
      }
      if (solid && p.climate.hydrosphere === 'magma' && coverage > 0 && clarity > 0.15 && lavaLight >= MIN_SCENIC_REFLECTED_LIGHT) {
        add('lava', body.name, litScore(0.55 * clarity + 0.45 * (coverage < 0.9 ? 1 : 0.3), lavaLight),
          [`${fmt(coverage * 100, 2)}% exposed melt`, coverage < 0.9 ? 'Dark terrain can contrast with lava' : 'Global magma surface', 'Self-lit lava · visible thermal emission', lightingNote],
          'Approach the terminator from the night side; look for glowing melt against unlit relief.', moon);
      }
      if (solid && clarity > 0.35 && system.companions.length && surfaceLight >= MIN_SCENIC_REFLECTED_LIGHT) {
        const otherIndex = daylight.sourcesEarth.reduce((best, power, i) => i !== hostIndex && (best < 0 || power > daylight.sourcesEarth[best]) ? i : best, -1);
        const other = otherIndex === 0 ? system.star : system.companions[otherIndex - 1].star;
        const separation = system.companions[Math.max(0, hostIndex - 1, otherIndex - 1)].elements.semiMajorAxis / AU;
        const orbit = planet.elements.semiMajorAxis / AU;
        // Orbital-scale proxy, not a solved simultaneous sunset or epoch geometry.
        const hostLight = daylight.sourcesEarth[hostIndex];
        const otherLight = daylight.sourcesEarth[otherIndex];
        const ratio = otherLight / Math.max(hostLight, 1e-30);
        const angle = Math.atan2(separation, orbit) * 180 / Math.PI;
        if (Math.min(hostLight, otherLight) > 1e-6 && ratio >= 0.01 && ratio <= 100 && angle > 0.5) add('binary', body.name,
          litScore(0.5 * clarity + 0.25 * (1 - Math.abs(Math.log10(ratio)) / 2) + 0.25 * clamp(Math.abs(host.star.tEff - other.tEff) / 4000), surfaceLight),
          [`${host.star.spectralType} + ${other.spectralType}`, `Companion visible light ≈ ${fmt(ratio, 2)}× host over sampled orbit`, lightingNote],
          'Inspect both stars from the surface. Adjust time and viewing direction for a low pair; simultaneous sunset is not guaranteed.', moon);
      }
    }
  }
  return found;
}

/** Cap each category and round-robin mixed results so one abundant type cannot crowd out the others. */
export function shortlistScenes(candidates: readonly SceneCandidate[], filter: SceneFilter, limit = 16): SceneCandidate[] {
  const unique = [...new Map(candidates.filter(c => filter === 'all' || c.kind === filter).map(c => [c.id, c])).values()]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const varied = (items: SceneCandidate[]) => {
    const buckets = [...new Set(items.map(c => c.variant ?? 'default'))].map(variant => items.filter(c => (c.variant ?? 'default') === variant));
    const ordered: SceneCandidate[] = [];
    while (buckets.some(b => b.length)) for (const bucket of buckets) if (bucket.length) ordered.push(bucket.shift()!);
    return ordered;
  };
  if (filter !== 'all') return varied(unique).slice(0, limit);
  const groups = Object.keys(SCENE_TYPES).map(kind => varied(unique.filter(c => c.kind === kind)));
  const result: SceneCandidate[] = [];
  while (result.length < limit && groups.some(group => group.length)) for (const group of groups) {
    if (group.length && result.length < limit) result.push(group.shift()!);
  }
  return result;
}
