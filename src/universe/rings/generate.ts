import { EARTH_RADIUS } from '../../core/physics/constants';
import type { Rng } from '../../core/rng/rng';
import { rocheLimitPlanetRadii } from '../moon/generate';
import type { Moon } from '../moon/types';
import type { Planet, SystemZones } from '../system/types';
import type { RingGap, RingSystem } from './types';

/**
 * Ring systems live inside the Roche limit where moons cannot accrete.
 * Cold giants beyond the frost line keep bright icy rings; inside it
 * (or for small worlds) only dark dusty rings survive. Gaps are cleared
 * at interior mean-motion resonances of the major moons.
 */
export function generateRings(
  rng: Rng,
  planet: Planet,
  moons: Moon[],
  zones: SystemZones,
  aAu: number,
): RingSystem | null {
  const envelope = planet.class === 'gas-giant' || planet.class === 'ice-giant';
  if (!envelope) {
    // Rocky ring systems are rare, recent-disruption debris.
    if (!rng.bool(0.03)) return null;
    return build(rng, planet, moons, 'dusty', rng.range(0.02, 0.08));
  }

  const icy = aAu > zones.frostLineAu;
  const roll = rng.float();
  if (roll < 0.25 && icy) {
    // Saturn-class showpiece.
    return build(rng, planet, moons, 'icy', rng.range(0.5, 1.2));
  }
  if (roll < 0.75) {
    return build(rng, planet, moons, icy ? 'icy' : 'dusty', rng.range(0.02, 0.12));
  }
  return null;
}

function build(
  rng: Rng,
  planet: Planet,
  moons: Moon[],
  composition: 'icy' | 'dusty',
  opticalDepth: number,
): RingSystem {
  const roche = rocheLimitPlanetRadii(planet.physical.bulk.densityGcc, composition === 'icy' ? 0.9 : 2.5);
  const outer = roche * rng.range(0.85, 1.0);
  const inner = Math.max(1.15, outer * rng.range(0.45, 0.62));

  // Interior resonances of the major moons carve gaps where they land in the ring.
  const gaps: RingGap[] = [];
  const planetRadiusM = planet.physical.bulk.radiusEarth * EARTH_RADIUS;
  for (const moon of moons) {
    if (moon.channel === 'capture') continue;
    const moonRadii = moon.elements.semiMajorAxis / planetRadiusM;
    for (const [resonance, p, q] of [
      ['2:1', 2, 1],
      ['3:1', 3, 1],
    ] as const) {
      const radius = moonRadii * (q / p) ** (2 / 3);
      if (radius > inner * 1.03 && radius < outer * 0.97) {
        gaps.push({
          radiusPlanetRadii: radius,
          widthPlanetRadii: rng.range(0.02, 0.06),
          resonance,
        });
      }
    }
  }

  return {
    innerPlanetRadii: inner,
    outerPlanetRadii: outer,
    opticalDepth,
    composition,
    hue: composition === 'icy' ? [0.78, 0.74, 0.68] : [0.28, 0.25, 0.22],
    albedo: composition === 'icy' ? 0.6 : 0.08,
    gaps,
    forwardScatter: composition === 'icy' ? rng.range(0.8, 1.5) : rng.range(1.2, 2.2),
  };
}
