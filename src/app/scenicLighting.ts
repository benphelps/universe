import { orbitalPeriod } from '../core/math/orbit';
import { AU, EARTH_MASS, G, SOLAR_LUMINOSITY, SOLAR_MASS } from '../core/physics/constants';
import { mu as muOf } from '../core/physics/units';
import { splitStellarLight, stellarBandRgb } from '../core/color/stellarLight';
import { incidentBeams, stellarForcing } from '../universe/planet/illumination';
import type { Planet, StarSystem } from '../universe/system/types';
import { blackbodySurfaceEmission } from '../render/lighting/thermalEmission';
import { fmt } from './ui/format';

export const SOLAR_VISIBLE_POWER = splitStellarLight(stellarBandRgb(1, 5772)).luminosity;
const SOLAR_FLUX = SOLAR_LUMINOSITY / (4 * Math.PI * AU ** 2);
export interface ScenicLight {
  /** Visible incident power relative to sunlight at Earth, outside the atmosphere. */
  meanEarth: number;
  minimumEarth: number;
  maximumEarth: number;
  /** Mean contribution per star, in system order. */
  sourcesEarth: number[];
}

/** Twelve orbital samples, using the renderer's prescribed stellar paths and
 * optical spectrum. This is scouting daylight, not a local sun elevation,
 * eclipse prediction, or a bound over long-period companion configurations. */
export function scenicDaylight(system: StarSystem, hostIndex: number, planet: Planet): ScenicLight {
  const stars = [system.star, ...system.companions.map(c => c.star)];
  const base = stellarForcing(system.star, system.companions, system.configuration, hostIndex);
  const massSolar = hostIndex === 0 ? system.centralMassSolar : stars[hostIndex].mass;
  const orbit = { elements: planet.elements, mu: muOf(G * (massSolar * SOLAR_MASS + planet.physical.bulk.massEarth * EARTH_MASS)) };
  const forcing = { ...base, orbit, sources: base.sources.map((source, i) => ({ ...source,
    luminositySolar: splitStellarLight(stellarBandRgb(stars[i].luminosity, stars[i].tEff)).luminosity / SOLAR_VISIBLE_POWER })) };
  const period = orbitalPeriod(orbit.mu, planet.elements.semiMajorAxis);
  const totals: number[] = [];
  const sourcesEarth = stars.map(() => 0);
  for (let sample = 0; sample < 12; sample++) {
    const beams = incidentBeams(forcing, planet.physical.rotation, planet.elements.epoch + sample * period / 12);
    const powers = beams.map(beam => Math.max(0, beam.fluxWm2 / SOLAR_FLUX));
    powers.forEach((power, i) => { sourcesEarth[i] += power / 12; });
    totals.push(powers.reduce((sum, v) => sum + v, 0));
  }
  return { meanEarth: sourcesEarth.reduce((sum, v) => sum + v, 0), minimumEarth: Math.min(...totals), maximumEarth: Math.max(...totals), sourcesEarth };
}

/** Logarithmic photographic preference: moonlit-scale scenes score below
 * daylight. Extra power above Earth daylight does not keep inflating merit. */
export function scenicLightScore(visibleEarth: number): number {
  return Number.isFinite(visibleEarth) && visibleEarth > 0 ? Math.max(0, Math.min(1, (Math.log10(visibleEarth) + 5) / 5)) : 0;
}

export const MIN_SCENIC_REFLECTED_LIGHT = 1e-5;
export function scenicLightNote(light: ScenicLight): string {
  const level = light.meanEarth >= 0.1 ? 'Strong daylight' : light.meanEarth >= 0.001 ? 'Subdued daylight' : 'Very dim daylight';
  const variable = light.maximumEarth > light.minimumEarth * 2 ? ` · sampled ${fmt(light.minimumEarth, 2)}–${fmt(light.maximumEarth, 2)}×` : '';
  return `${level} · ${fmt(light.meanEarth, 2)}× Earth visible sunlight${variable} (above atmosphere)`;
}

/** Same visible thermal-emission response as terrain; no free glow from heat
 * that is almost entirely infrared. Units are the renderer's white-sunlit reference. */
export function scenicLavaEmission(temperatureK: number, albedo: number): number {
  return blackbodySurfaceEmission(temperatureK).strength * Math.max(0, Math.min(1, 1 - albedo));
}
