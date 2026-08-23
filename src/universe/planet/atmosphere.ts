import { K_B } from '../../core/physics/constants';
import { logNormal } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import type { Star } from '../star/types';
import type { PlanetClass } from '../system/types';
import type { AtmosphereClass, PlanetAtmosphere, PlanetBulk, PlanetInterior } from './types';

const AMU = 1.66054e-27;

/** Mean molecular mass (amu) and greenhouse coefficient τ = k·P^0.7 per class. */
const CLASS_PROPERTIES: Record<AtmosphereClass, { molecularMass: number; greenhouseK: number }> = {
  none: { molecularMass: 0, greenhouseK: 0 },
  'hydrogen-helium': { molecularMass: 2.3, greenhouseK: 2 },
  nitrogen: { molecularMass: 28, greenhouseK: 0.85 },
  'nitrogen-oxygen': { molecularMass: 28.6, greenhouseK: 0.85 },
  'co2-hothouse': { molecularMass: 44, greenhouseK: 5.8 },
  'thin-co2': { molecularMass: 44, greenhouseK: 5.8 },
  'nitrogen-methane': { molecularMass: 28, greenhouseK: 1.4 },
  'rock-vapor': { molecularMass: 30, greenhouseK: 0.1 },
};

/** Rayleigh/haze limb-and-sky tints per class, linear sRGB. */
const SCATTERING_COLOR: Record<AtmosphereClass, [number, number, number]> = {
  none: [0, 0, 0],
  'hydrogen-helium': [0.5, 0.65, 1.0],
  nitrogen: [0.35, 0.55, 1.0],
  'nitrogen-oxygen': [0.35, 0.55, 1.0],
  'co2-hothouse': [0.9, 0.75, 0.5],
  'thin-co2': [0.75, 0.6, 0.5],
  'nitrogen-methane': [0.85, 0.65, 0.35],
  'rock-vapor': [0.6, 0.5, 0.45],
};

/**
 * Retention → composition → pressure. A species survives when the escape
 * velocity exceeds ~6× its thermal speed at the exobase (Jeans), with an
 * XUV-history penalty for close-in planets of low-mass stars — the
 * cosmic-shoreline behavior.
 */
export function computeAtmosphere(
  rng: Rng,
  planetClass: PlanetClass,
  bulk: PlanetBulk,
  interior: PlanetInterior,
  star: Star,
  rawEquilibriumK: number,
  frostLineAu: number,
  habitableInnerAu: number,
  aAu: number,
): PlanetAtmosphere {
  const envelope =
    planetClass === 'gas-giant' || planetClass === 'ice-giant' || planetClass === 'mini-neptune';
  if (envelope) {
    return build('hydrogen-helium', rng.range(1000, 100000), rawEquilibriumK, bulk);
  }

  const exobaseK = rawEquilibriumK * 1.5;
  // M-dwarf XUV history strips close-in atmospheres harder.
  const xuvPenalty = star.massInitial < 0.5 ? 1.6 : 1.15;
  const retains = (molecularMassAmu: number): boolean => {
    const thermalKms = Math.sqrt((2 * K_B * exobaseK) / (molecularMassAmu * AMU)) / 1000;
    return bulk.escapeVelocityKms > 6 * thermalKms * xuvPenalty;
  };

  if (interior.regime === 'magma' || rawEquilibriumK > 1400) {
    return retains(30)
      ? build('rock-vapor', logNormal(rng, Math.log(1e-4), 1), rawEquilibriumK, bulk)
      : build('none', 0, rawEquilibriumK, bulk);
  }

  if (!retains(44)) return build('none', 0, rawEquilibriumK, bulk);

  // Below ~40 K every candidate volatile condenses onto the surface.
  if (rawEquilibriumK < 40) return build('none', 0, rawEquilibriumK, bulk);

  if (!retains(28)) {
    // Holds only heavy CO2, thinly (Mars-like).
    return build('thin-co2', logNormal(rng, Math.log(0.01), 1.2), rawEquilibriumK, bulk);
  }

  // Volcanically resupplied secondary atmospheres need a live interior.
  if (interior.regime === 'dead' && rng.bool(0.6)) {
    return build('thin-co2', logNormal(rng, Math.log(0.005), 1.5), rawEquilibriumK, bulk);
  }

  if (aAu < habitableInnerAu) {
    // Inside the runaway-greenhouse limit water never condenses: CO2 accumulates.
    return build('co2-hothouse', logNormal(rng, Math.log(70), 0.7), rawEquilibriumK, bulk);
  }
  if (rawEquilibriumK < 100 && aAu > frostLineAu) {
    return build('nitrogen-methane', logNormal(rng, Math.log(1.5), 0.5), rawEquilibriumK, bulk);
  }
  return build('nitrogen', logNormal(rng, Math.log(1), 0.45), rawEquilibriumK, bulk);
}

function build(
  atmosphereClass: AtmosphereClass,
  surfacePressureBar: number,
  temperatureK: number,
  bulk: PlanetBulk,
): PlanetAtmosphere {
  const properties = CLASS_PROPERTIES[atmosphereClass];
  const scaleHeightKm =
    atmosphereClass === 'none'
      ? 0
      : (K_B * temperatureK) / (properties.molecularMass * AMU * bulk.gravityMs2) / 1000;
  return {
    class: atmosphereClass,
    surfacePressureBar,
    scaleHeightKm,
    opticalDepth: properties.greenhouseK * surfacePressureBar ** 0.7,
    scatteringColor: SCATTERING_COLOR[atmosphereClass],
  };
}

/** Promote a nitrogen atmosphere to oxygen-bearing (used when a biosphere emerges). */
export function withOxygen(atmosphere: PlanetAtmosphere): PlanetAtmosphere {
  return {
    ...atmosphere,
    class: 'nitrogen-oxygen',
    scatteringColor: SCATTERING_COLOR['nitrogen-oxygen'],
  };
}
