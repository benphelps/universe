import type { OrbitalElements } from '../../core/math/orbit';
import { orbitalPeriod } from '../../core/math/orbit';
import { mu as muOf } from '../../core/physics/units';
import { AU, EARTH_MASS, EARTH_RADIUS, G } from '../../core/physics/constants';
import { logNormal } from '../../core/rng/distributions';
import { deriveSeed, seedToHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { computeAppearance } from '../planet/appearance';
import { computeAtmosphere } from '../planet/atmosphere';
import { computeBulk } from '../planet/bulk';
import { computeClimate } from '../planet/climate';
import { computeInterior } from '../planet/interior';
import type { Characterization, PlanetRotation } from '../planet/types';
import type { Star } from '../star/types';
import type { Planet, SystemZones } from '../system/types';
import type { Moon, MoonChannel, TidalState } from './types';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export interface MoonContext {
  star: Star;
  centralLuminosity: number;
  zones: SystemZones;
}

/** Fluid Roche limit in planet radii for a satellite of density rhoMoon (g/cc). */
export function rocheLimitPlanetRadii(planetDensityGcc: number, moonDensityGcc: number): number {
  return 2.44 * (planetDensityGcc / moonDensityGcc) ** (1 / 3);
}

/** Io-calibrated planet-raised tidal heat flux, W/m². */
export function tidalHeatFluxWm2(
  planetMassEarth: number,
  eccentricity: number,
  moonRadiusEarth: number,
  semiMajorAxisM: number,
): number {
  const aScaled = semiMajorAxisM / 1e8;
  return (
    (2.84e5 * planetMassEarth ** 2 * eccentricity ** 2 * moonRadiusEarth ** 3) / aScaled ** 6
  );
}

/**
 * Satellite system for a planet. Giants build regular co-accretion moons
 * (total ~10⁻⁴ of the planet, resonance chains that pump eccentricity and
 * tidal heat) plus distant irregular captures; terrestrials can host one
 * impact-formed large moon (recession by age) or captured moonlets.
 */
export function generateMoons(seed: bigint, planet: Planet, context: MoonContext): Moon[] {
  const rng = new Rng(seed);
  const envelope = planet.class === 'gas-giant' || planet.class === 'ice-giant';
  const moons = envelope
    ? giantSystem(rng, seed, planet, context)
    : terrestrialSystem(rng, seed, planet, context);
  return moons;
}

function giantSystem(rng: Rng, seed: bigint, planet: Planet, context: MoonContext): Moon[] {
  const planetMass = planet.physical.bulk.massEarth;
  const totalMass = planetMass * logNormal(rng, Math.log(1e-4), 0.5);
  const count = 2 + rng.int(5);

  // Split the budget log-randomly, then place outward from near the Roche limit.
  const shares = Array.from({ length: count }, () => logNormal(rng, 0, 0.8));
  const shareSum = shares.reduce((a, b) => a + b, 0);
  const roche = rocheLimitPlanetRadii(planet.physical.bulk.densityGcc, 1.8);

  const moons: Moon[] = [];
  let aPlanetRadii = roche * rng.range(1.3, 2.2);
  let previousResonant = false;
  for (let i = 0; i < count; i++) {
    const massEarth = Math.max(1e-8, (totalMass * shares[i]) / shareSum);
    const resonant = i > 0 && rng.bool(0.5);
    // Resonance keeps eccentricity pumped against tidal circularization.
    const eccentricity = resonant || previousResonant ? rng.range(0.002, 0.01) : rng.range(0.0003, 0.003);
    moons.push(
      buildMoon(deriveSeed(seed, 'moon', i), planet, context, {
        channel: 'coaccretion',
        index: i,
        massEarth,
        aPlanetRadii,
        eccentricity,
        inclination: Math.abs(rng.normal(0, 0.01)),
        retrograde: false,
        resonanceWithInner: resonant ? '2:1' : null,
        rng,
      }),
    );
    previousResonant = resonant;
    // 2:1 period ratio when resonant, otherwise free spacing.
    aPlanetRadii *= resonant ? 2 ** (2 / 3) : rng.range(1.6, 2.3);
  }

  const irregularCount = rng.int(4);
  for (let i = 0; i < irregularCount; i++) {
    moons.push(
      buildMoon(deriveSeed(seed, 'irregular', i), planet, context, {
        channel: 'capture',
        index: count + i,
        massEarth: logNormal(rng, Math.log(3e-9), 1.2),
        aPlanetRadii: rng.range(100, 400),
        eccentricity: rng.range(0.1, 0.5),
        inclination: rng.range(0.3, 1.2),
        retrograde: rng.bool(0.6),
        resonanceWithInner: null,
        rng,
      }),
    );
  }
  return moons;
}

function terrestrialSystem(rng: Rng, seed: bigint, planet: Planet, context: MoonContext): Moon[] {
  const moons: Moon[] = [];
  const bulk = planet.physical.bulk;
  const locked = planet.physical.rotation.locked;

  // Giant-impact moon: needs a substantial, not-despun primary.
  if (!locked && bulk.massEarth > 0.3 && rng.bool(0.35)) {
    const massRatio = logNormal(rng, Math.log(0.012), 0.5);
    // Tidal recession: young moons orbit close, old ones far.
    const aPlanetRadii = Math.min(75, Math.max(15, 25 + 35 * Math.sqrt(context.star.ageGyr / 4.6)));
    moons.push(
      buildMoon(deriveSeed(seed, 'moon', 0), planet, context, {
        channel: 'impact',
        index: 0,
        massEarth: bulk.massEarth * massRatio,
        aPlanetRadii,
        eccentricity: rng.range(0.01, 0.08),
        inclination: Math.abs(rng.normal(0, 0.1)),
        retrograde: false,
        resonanceWithInner: null,
        rng,
      }),
    );
    return moons;
  }

  // Captured moonlets (Phobos-class), doomed low orbiters included.
  if (rng.bool(0.25)) {
    const count = 1 + rng.int(2);
    for (let i = 0; i < count; i++) {
      moons.push(
        buildMoon(deriveSeed(seed, 'moonlet', i), planet, context, {
          channel: 'capture',
          index: i,
          massEarth: logNormal(rng, Math.log(2e-9), 1),
          aPlanetRadii: rng.range(2.5, 9),
          eccentricity: rng.range(0.0, 0.05),
          inclination: Math.abs(rng.normal(0, 0.05)),
          retrograde: false,
          resonanceWithInner: null,
          rng,
        }),
      );
    }
  }
  return moons;
}

interface MoonSpec {
  channel: MoonChannel;
  index: number;
  massEarth: number;
  aPlanetRadii: number;
  eccentricity: number;
  inclination: number;
  retrograde: boolean;
  resonanceWithInner: string | null;
  rng: Rng;
}

function buildMoon(seed: bigint, planet: Planet, context: MoonContext, spec: MoonSpec): Moon {
  const rng = new Rng(seed);
  const { star, centralLuminosity, zones } = context;
  const planetBulk = planet.physical.bulk;
  const aAu = planet.elements.semiMajorAxis / AU;
  const icyZone = aAu > zones.frostLineAu;
  const rawEquilibriumK = 278.6 * (centralLuminosity / aAu ** 2) ** 0.25 * 0.7 ** 0.25;

  const semiMajorAxisM = spec.aPlanetRadii * planetBulk.radiusEarth * EARTH_RADIUS;
  const mu = muOf(G * (planetBulk.massEarth + spec.massEarth) * EARTH_MASS);
  const periodHours = orbitalPeriod(mu, semiMajorAxisM) / 3600;

  const elements: OrbitalElements = {
    semiMajorAxis: semiMajorAxisM,
    eccentricity: spec.eccentricity,
    inclination: spec.retrograde ? Math.PI - spec.inclination : spec.inclination,
    longitudeOfAscendingNode: rng.range(0, 2 * Math.PI),
    argumentOfPeriapsis: rng.range(0, 2 * Math.PI),
    meanAnomalyAtEpoch: rng.range(0, 2 * Math.PI),
    epoch: 0,
  };

  // Regular moons lock quickly; distant irregulars keep primordial spin.
  const locked = spec.channel !== 'capture' || spec.aPlanetRadii < 40;
  const rotation: PlanetRotation = {
    periodHours: locked ? periodHours : rng.range(5, 60),
    obliquityRad: 0,
    locked,
    spinOrbitResonance: null,
  };

  const ironCoreFraction = icyZone ? rng.range(0.08, 0.2) : rng.range(0.2, 0.4);
  const bulk = computeBulk(
    rng.fork('bulk'),
    spec.massEarth,
    'rocky',
    rawEquilibriumK,
    rotation.periodHours,
    ironCoreFraction,
  );
  const tidalFlux = tidalHeatFluxWm2(
    planetBulk.massEarth,
    spec.eccentricity,
    bulk.radiusEarth,
    semiMajorAxisM,
  );

  const interior = computeInterior(
    rng.fork('interior'),
    'rocky',
    bulk,
    rotation,
    ironCoreFraction,
    star.ageGyr,
    aAu,
    0,
    tidalFlux,
  );
  const atmosphere = computeAtmosphere(
    rng.fork('atmosphere'),
    'rocky',
    bulk,
    interior,
    star,
    rawEquilibriumK,
    zones.frostLineAu,
    zones.habitableInnerAu,
    aAu,
  );
  const climate = computeClimate(
    rng.fork('climate'),
    'rocky',
    atmosphere,
    bulk,
    interior,
    rotation,
    star.linearRgb,
    centralLuminosity,
    aAu,
    star.ageGyr,
  );
  const appearance = computeAppearance(
    rng.fork('appearance'),
    'rocky',
    bulk,
    atmosphere,
    climate,
    interior,
    rotation,
    star.ageGyr,
  );

  const tidalState = classifyTidalState(tidalFlux, icyZone, climate.surfaceMeanK);
  // Tidal identity shows on the surface: sulfur volcanism or fresh ice.
  if (tidalState === 'volcanic') {
    appearance.landColorA = [0.72, 0.6, 0.26];
    appearance.landColorB = [0.5, 0.38, 0.16];
    appearance.lavaGlow = Math.max(appearance.lavaGlow, 0.7);
  } else if (icyZone && atmosphere.class === 'none') {
    appearance.landColorA = tidalState === 'dead' ? [0.5, 0.5, 0.52] : [0.75, 0.78, 0.82];
    appearance.landColorB = [0.62, 0.63, 0.66];
  }

  const physical: Characterization = {
    seedHex: seedToHex(seed),
    bulk,
    interior,
    rotation,
    atmosphere,
    climate,
    appearance,
  };

  return {
    name: `${planet.name} ${ROMAN[Math.min(spec.index, ROMAN.length - 1)]}`,
    channel: spec.channel,
    elements,
    semiMajorAxisPlanetRadii: spec.aPlanetRadii,
    retrograde: spec.retrograde,
    tidalHeatFluxWm2: tidalFlux,
    tidalState,
    resonanceWithInner: spec.resonanceWithInner,
    physical,
  };
}

function classifyTidalState(fluxWm2: number, icy: boolean, surfaceK: number): TidalState {
  if (fluxWm2 > 2) return 'volcanic';
  if (fluxWm2 > 0.3) return icy && surfaceK < 220 ? 'cryovolcanic' : 'volcanic';
  if (fluxWm2 > 0.05 && icy && surfaceK < 220) return 'subsurface-ocean';
  return 'dead';
}
