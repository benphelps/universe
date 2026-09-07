import { K_B } from '../../core/physics/constants';
import { columnStateAt, type HydrostaticColumn } from './hydrostaticColumn';
import { partitionWater, waterColumnInventory, WATER_MOLECULAR_MASS } from './waterInventory';
import { logNormal } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import type { Star } from '../star/types';
import type { PlanetClass } from '../system/types';
import type { AtmosphericGas, AtmosphereClass, PlanetAtmosphere, PlanetBulk, PlanetClimate, PlanetInterior } from './types';

const AMU = 1.66054e-27;

/** Representative bulk mixtures, not a photochemical equilibrium solver.
 *  The rock-vapor preset is a surrogate until elemental inventories exist. */
const MIXTURES: Record<AtmosphereClass, Partial<Record<AtmosphericGas, number>>> = {
  none: {}, 'hydrogen-helium': { H2: 0.85, He: 0.15 }, nitrogen: { N2: 1 },
  'nitrogen-oxygen': { N2: 0.79, O2: 0.21 }, 'co2-hothouse': { CO2: 1 },
  'thin-co2': { CO2: 1 }, 'nitrogen-methane': { N2: 0.95, CH4: 0.05 },
  'rock-vapor': { SiO: 0.5, O2: 0.3, Na: 0.2 },
};
const GAS_PROPERTIES: Record<AtmosphericGas, { mass: number; cp: number; rayleigh: number }> = {
  H2: { mass: 2, cp: 14300, rayleigh: 2.84 }, He: { mass: 4, cp: 5193, rayleigh: 0.005 },
  N2: { mass: 28, cp: 1040, rayleigh: 1 }, O2: { mass: 32, cp: 918, rayleigh: 1 },
  CO2: { mass: 44, cp: 844, rayleigh: 1.6 }, CH4: { mass: 16, cp: 2200, rayleigh: 1 },
  SiO: { mass: 44, cp: 1000, rayleigh: 1 }, Na: { mass: 23, cp: 900, rayleigh: 1 },
  // Constant-cp dilute vapor; visible scattering retains the neutral-gas
  // proxy pending wavelength-resolved molecular cross sections.
  H2O: { mass: WATER_MOLECULAR_MASS, cp: 1850, rayleigh: 1 },
};

function gasInventory(atmosphere: PlanetAtmosphere): Partial<Record<AtmosphericGas, number>> {
  return atmosphere.partialPressuresBar ?? Object.fromEntries(
    Object.entries(MIXTURES[atmosphere.class]).map(([gas, fraction]) => [gas, fraction * atmosphere.surfacePressureBar]),
  );
}

/** Derive all bulk molecular properties from the same final inventory.
 *  Partial pressure fractions are mole fractions; cp and scattering per
 *  unit column mass therefore use mass fractions, not mole fractions. */
export function atmosphereAtTemperature(atmosphere: PlanetAtmosphere, temperatureK: number, bulk: PlanetBulk): PlanetAtmosphere {
  const partial = gasInventory(atmosphere);
  let pressure = 0, molecularWeight = 0, heatCapacity = 0, scattering = 0;
  for (const [name, p] of Object.entries(partial)) {
    const gas = GAS_PROPERTIES[name as AtmosphericGas];
    pressure += p;
    molecularWeight += p * gas.mass;
    heatCapacity += p * gas.mass * gas.cp;
    scattering += p * gas.mass * gas.rayleigh;
  }
  const molecularMass = pressure > 0 ? molecularWeight / pressure : 0;
  let kind = atmosphere.class;
  if (pressure <= 0) kind = 'none';
  else if ((partial.CO2 ?? 0) / pressure >= 0.5) kind = pressure > 1 ? 'co2-hothouse' : 'thin-co2';
  else if ((partial.H2 ?? 0) / pressure > 0.5) kind = 'hydrogen-helium';
  else if (((partial.SiO ?? 0) + (partial.Na ?? 0)) / pressure > 0.5) kind = 'rock-vapor';
  else if ((partial.CH4 ?? 0) / pressure > 0.01) kind = 'nitrogen-methane';
  else if ((partial.O2 ?? 0) / pressure > 0.01 && (partial.N2 ?? 0) / pressure > 0.4) kind = 'nitrogen-oxygen';
  else if ((partial.N2 ?? 0) > 0) kind = 'nitrogen';
  return {
    ...atmosphere, class: kind, partialPressuresBar: { ...partial }, surfacePressureBar: pressure,
    aerosolClass: atmosphere.aerosolClass ?? atmosphere.class,
    meanMolecularMassAmu: molecularMass,
    specificHeatJkgK: molecularWeight > 0 ? heatCapacity / molecularWeight : 1000,
    rayleighPerBar: molecularWeight > 0 ? scattering / molecularWeight : 0,
    scaleHeightKm: molecularMass > 0 ? K_B * temperatureK / (molecularMass * AMU * bulk.gravityMs2) / 1000 : 0,
    scatteringColor: SCATTERING_COLOR[kind],
  };
}

/** Replace the extra CO2 reservoir, including when called repeatedly during
 *  climate iteration. The original CO2 and newly supplied CO2 absorb as one
 *  column under the existing gray pressure law. */
export function withThermostatCo2(atmosphere: PlanetAtmosphere, co2Bar: number, temperatureK: number, bulk: PlanetBulk): PlanetAtmosphere {
  atmosphere = withoutWaterVapor(atmosphere, temperatureK, bulk);
  const partial = { ...gasInventory(atmosphere) };
  const oldCo2 = partial.CO2 ?? 0;
  const added = Math.max(0, co2Bar);
  const newCo2 = Math.max(0, oldCo2 - (atmosphere.thermostatCo2Bar ?? 0)) + added;
  if (newCo2 > 0) partial.CO2 = newCo2;
  else delete partial.CO2;
  return atmosphereAtTemperature({
    ...atmosphere, partialPressuresBar: partial, thermostatCo2Bar: added,
    opticalDepth: Math.max(0, atmosphere.opticalDepth + 5.8 * (newCo2 ** 0.7 - oldCo2 ** 0.7)),
  }, temperatureK, bulk);
}

export function thermostatCo2ForOpticalDepth(atmosphere: PlanetAtmosphere, targetTau: number): number {
  const initialCo2 = gasInventory(atmosphere).CO2 ?? 0;
  const otherTau = atmosphere.opticalDepth - 5.8 * initialCo2 ** 0.7;
  return Math.max(0, (Math.max(0, targetTau - otherTau) / 5.8) ** (1 / 0.7) - initialCo2);
}

/** Shared planet/moon finalization, including biosphere and scale height. */
export function finalizeAtmosphere(atmosphere: PlanetAtmosphere, climate: PlanetClimate, bulk: PlanetBulk): PlanetAtmosphere {
  const dry = withoutWaterVapor(atmosphere, climate.surfaceMeanK, bulk);
  return withWaterVapor(withThermostatCo2(climate.biosphere ? withOxygen(dry) : dry,
    climate.co2Bar, climate.surfaceMeanK, bulk), climate.waterMassFraction, climate.surfaceMeanK, bulk);
}

/** Remove only water while preserving each dry species' column mass. */
function withoutWaterVapor(atmosphere: PlanetAtmosphere, temperatureK: number, bulk: PlanetBulk): PlanetAtmosphere {
  const partial = gasInventory(atmosphere), water = partial.H2O ?? 0;
  if (!(water > 0)) return atmosphere;
  const mixture = atmosphereAtTemperature(atmosphere, temperatureK, bulk);
  const pressure = mixture.surfacePressureBar, dryPressure = pressure - water * WATER_MOLECULAR_MASS / mixture.meanMolecularMassAmu!;
  const scale = dryPressure / (pressure - water);
  const dry = Object.fromEntries(Object.entries(partial).filter(([name]) => name !== 'H2O').map(([name, p]) => [name, p * scale]));
  return atmosphereAtTemperature({ ...atmosphere, partialPressuresBar: dry, waterReservoir: undefined }, temperatureK, bulk);
}

/** Install a finite vapor reservoir after the dry gas/CO2/biosphere pass.
 * The existing gray IR coefficient remains a bulk opacity proxy (including
 * unresolved absorbers), not a species-resolved H2O opacity calibration. */
export function withWaterVapor(atmosphere: PlanetAtmosphere, waterMassFraction: number | undefined,
  temperatureK: number, bulk: PlanetBulk): PlanetAtmosphere {
  if (waterMassFraction === undefined || atmosphere.class === 'hydrogen-helium') return atmosphere;
  const dry = atmosphereAtTemperature(withoutWaterVapor(atmosphere, temperatureK, bulk), temperatureK, bulk);
  const reservoir = partitionWater(waterColumnInventory(waterMassFraction, bulk), dry.surfacePressureBar * 1e5,
    dry.meanMolecularMassAmu ?? 0, bulk.gravityMs2, temperatureK);
  const { partialPa, weightPa, ...waterReservoir } = reservoir;
  if (waterReservoir.status !== 'dilute' || partialPa === 0) return { ...dry, waterReservoir };
  const pressurePa = dry.surfacePressureBar * 1e5 + weightPa;
  const scale = (pressurePa - partialPa) / (dry.surfacePressureBar * 1e5);
  const partial = Object.fromEntries(Object.entries(gasInventory(dry)).map(([name, p]) => [name, p * scale]));
  partial.H2O = partialPa / 1e5;
  return atmosphereAtTemperature({ ...dry, partialPressuresBar: partial, waterReservoir }, temperatureK, bulk);
}

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
  return atmosphereAtTemperature({
    class: atmosphereClass,
    surfacePressureBar,
    scaleHeightKm,
    opticalDepth: properties.greenhouseK * surfacePressureBar ** 0.7,
    scatteringColor: SCATTERING_COLOR[atmosphereClass],
  }, temperatureK, bulk);
}

/** Promote a nitrogen atmosphere to oxygen-bearing (used when a biosphere emerges). */
export function withOxygen(atmosphere: PlanetAtmosphere): PlanetAtmosphere {
  const partial = { ...gasInventory(atmosphere) };
  const nitrogen = partial.N2 ?? 0;
  // Idempotent oxygenation of the nitrogen/oxygen reservoir.
  const dry = nitrogen + (partial.O2 ?? 0);
  partial.N2 = dry * 0.79;
  partial.O2 = dry * 0.21;
  return {
    ...atmosphere,
    class: 'nitrogen-oxygen',
    scatteringColor: SCATTERING_COLOR['nitrogen-oxygen'],
    partialPressuresBar: partial,
  };
}

/** Earth's air scatters a tenth of green light out of the vertical
 *  column at one bar under one g; other columns scale with mass. */
const RAYLEIGH_TAU_GREEN_1BAR = 0.1;
const EARTH_GRAVITY_MS2 = 9.80665;
/** Rayleigh's λ⁻⁴ over the display's three bands, green at one. */
const RAYLEIGH_HUE: [number, number, number] = [0.64, 1, 1.82];
/**
 * How much a bar of each gas scatters against a bar of air: the
 * molecular cross-section over the molecular mass, relative to N₂ —
 * CO₂ scatters more per molecule and weighs more, hydrogen scatters
 * little per molecule but a bar of it is many molecules.
 */
const RAYLEIGH_PER_BAR: Record<AtmosphereClass, number> = {
  none: 0,
  'hydrogen-helium': 2.1,
  nitrogen: 1,
  'nitrogen-oxygen': 1,
  'co2-hothouse': 1.6,
  'thin-co2': 1.6,
  'nitrogen-methane': 1,
  'rock-vapor': 1,
};
/**
 * The haze each class carries: vertical extinction at green, its
 * extinction spectrum, and the share returned as scattered light. A
 * clear terrestrial sky's thin aerosol, a
 * giant's stratospheric haze, Venus's sulfur veil above the deck,
 * Mars's dust, Titan's tholins. Each depth belongs to a measured
 * reference column; terrestrial columns scale by their actual P/g,
 * and surface-fed dust also needs exposed mineral ground below it.
 */
const AEROSOL: Record<
  AtmosphereClass,
  {
    /** Measured reference column carrying `depth`, kg m⁻². Null where
     *  the visible deck, rather than the generated deep pressure, owns
     *  the aerosol column. */
    referenceColumnKgM2: number | null;
    /** Mineral dust needs exposed ground; photochemical and condensate
     *  hazes do not. */
    surfaceSourced: boolean;
    depth: number;
    extinctionHue: [number, number, number];
    singleScatteringAlbedo: [number, number, number];
    scaleHeightRatio: number;
  }
> = {
  none: {
    referenceColumnKgM2: null,
    surfaceSourced: false,
    depth: 0,
    extinctionHue: [1, 1, 1],
    singleScatteringAlbedo: [0, 0, 0],
    scaleHeightRatio: 1,
  },
  'hydrogen-helium': {
    referenceColumnKgM2: null,
    surfaceSourced: false,
    depth: 0.25,
    extinctionHue: [0.9, 1, 1.2],
    singleScatteringAlbedo: [0.96, 0.91, 0.76],
    scaleHeightRatio: 0.65,
  },
  nitrogen: {
    referenceColumnKgM2: 1e5 / EARTH_GRAVITY_MS2,
    surfaceSourced: false,
    depth: 0.03,
    extinctionHue: [0.95, 1, 1.08],
    singleScatteringAlbedo: [0.95, 0.94, 0.9],
    scaleHeightRatio: 0.22,
  },
  'nitrogen-oxygen': {
    referenceColumnKgM2: 1e5 / EARTH_GRAVITY_MS2,
    surfaceSourced: false,
    depth: 0.03,
    extinctionHue: [0.95, 1, 1.08],
    singleScatteringAlbedo: [0.95, 0.94, 0.9],
    scaleHeightRatio: 0.22,
  },
  'co2-hothouse': {
    referenceColumnKgM2: (92e5) / 8.87,
    surfaceSourced: false,
    depth: 2.5,
    extinctionHue: [0.72, 1, 1.45],
    singleScatteringAlbedo: [0.98, 0.92, 0.62],
    scaleHeightRatio: 0.55,
  },
  'thin-co2': {
    referenceColumnKgM2: 636 / 3.721,
    surfaceSourced: true,
    depth: 0.35,
    extinctionHue: [0.72, 1, 1.35],
    singleScatteringAlbedo: [0.96, 0.83, 0.52],
    scaleHeightRatio: 0.35,
  },
  'nitrogen-methane': {
    referenceColumnKgM2: (1.47e5) / 1.352,
    surfaceSourced: false,
    depth: 3,
    extinctionHue: [0.7, 1, 1.55],
    singleScatteringAlbedo: [0.96, 0.78, 0.34],
    scaleHeightRatio: 0.8,
  },
  'rock-vapor': {
    referenceColumnKgM2: 10 / EARTH_GRAVITY_MS2,
    surfaceSourced: false,
    depth: 1,
    extinctionHue: [0.78, 1, 1.3],
    singleScatteringAlbedo: [0.9, 0.72, 0.45],
    scaleHeightRatio: 0.45,
  },
};

/** Fraction of mineral ground available to feed a surface-sourced haze.
 *  `iceCapLatitudeRad` is π/2 with no caps and zero for a snowball, so
 *  its sine is the exposed area fraction of the sphere. */
export function aerosolSurfaceExposure(
  atmosphere: PlanetAtmosphere,
  iceCapLatitudeRad: number,
): number {
  if (!AEROSOL[atmosphere.aerosolClass ?? atmosphere.class].surfaceSourced) return 1;
  return Math.sin(Math.min(Math.PI / 2, Math.max(0, iceCapLatitudeRad)));
}

/** The two scatterers of a visible column, per channel: the gas's
 *  Rayleigh depth and the class's aerosol haze. */
export interface AirColumn {
  rayleigh: [number, number, number];
  /** Aerosol scattering optical depth. */
  aerosol: [number, number, number];
  /** Aerosol extinction optical depth: scattering plus absorption. */
  aerosolExtinction: [number, number, number];
  /** Aerosol scale height divided by the molecular-gas scale height. */
  aerosolScaleHeightRatio: number;
}

/**
 * Vertical Rayleigh optical depth of the gas column, per channel: the
 * column mass P/g, the gas's scattering per bar, and λ⁻⁴ across the
 * bands, scaled so air at Earth's column reproduces Earth's green depth.
 */
export function visibleOpticalDepth(
  atmosphere: PlanetAtmosphere,
  bulk: PlanetBulk,
): [number, number, number] {
  if (atmosphere.class === 'none') return [0, 0, 0];
  const column = (atmosphere.surfacePressureBar * EARTH_GRAVITY_MS2) / Math.max(bulk.gravityMs2, 0.1);
  const k = RAYLEIGH_TAU_GREEN_1BAR * column * (atmosphere.rayleighPerBar ?? RAYLEIGH_PER_BAR[atmosphere.class]);
  return [k * RAYLEIGH_HUE[0], k * RAYLEIGH_HUE[1], k * RAYLEIGH_HUE[2]];
}

/** Vertical aerosol extinction optical depth of the haze, per channel.
 *  A reference depth is a measured mass-mixing state, not a fixed sky
 *  opacity: for the same composition the aerosol column follows P/g. */
export function aerosolExtinctionDepth(
  atmosphere: PlanetAtmosphere,
  bulk: PlanetBulk,
  surfaceExposure = 1,
): [number, number, number] {
  const { depth, extinctionHue, referenceColumnKgM2, surfaceSourced } =
    AEROSOL[atmosphere.aerosolClass ?? atmosphere.class];
  const columnKgM2 = (atmosphere.surfacePressureBar * 1e5) / Math.max(bulk.gravityMs2, 0.1);
  const columnScale = referenceColumnKgM2 ? columnKgM2 / referenceColumnKgM2 : 1;
  const sourceScale = surfaceSourced ? Math.min(1, Math.max(0, surfaceExposure)) : 1;
  const tau = depth * columnScale * sourceScale;
  return [tau * extinctionHue[0], tau * extinctionHue[1], tau * extinctionHue[2]];
}

/** Vertical aerosol scattering optical depth, after absorptive losses. */
export function aerosolOpticalDepth(
  atmosphere: PlanetAtmosphere,
  bulk: PlanetBulk,
  surfaceExposure = 1,
): [number, number, number] {
  const extinction = aerosolExtinctionDepth(atmosphere, bulk, surfaceExposure);
  const { singleScatteringAlbedo } = AEROSOL[atmosphere.aerosolClass ?? atmosphere.class];
  return [
    extinction[0] * singleScatteringAlbedo[0],
    extinction[1] * singleScatteringAlbedo[1],
    extinction[2] * singleScatteringAlbedo[2],
  ];
}

export function atmosphereColumn(
  atmosphere: PlanetAtmosphere,
  bulk: PlanetBulk,
  surfaceExposure = 1,
): AirColumn {
  return {
    rayleigh: visibleOpticalDepth(atmosphere, bulk),
    aerosol: aerosolOpticalDepth(atmosphere, bulk, surfaceExposure),
    aerosolExtinction: aerosolExtinctionDepth(atmosphere, bulk, surfaceExposure),
    aerosolScaleHeightRatio: AEROSOL[atmosphere.aerosolClass ?? atmosphere.class].scaleHeightRatio,
  };
}

/** Visible Bond-albedo contribution of the gas/aerosol column. Rayleigh
 * scattering is isotropic in the mean; the aerosol term is reduced by the
 * same measured forward-asymmetry used by the renderer. Absorption competes
 * with the two-stream backscatter instead of a planet class choosing a fixed
 * albedo. `incidentRgb` weights the three visible bands by the host spectrum. */
export function atmosphericBondAlbedo(
  atmosphere: PlanetAtmosphere,
  bulk: PlanetBulk,
  incidentRgb: readonly [number, number, number],
  surfaceExposure = 1,
): number {
  const column = atmosphereColumn(atmosphere, bulk, surfaceExposure);
  const photopic = [0.2126, 0.7152, 0.0722] as const;
  const weights = photopic.map((weight, i) => weight * Math.max(incidentRgb[i], 0));
  const weightSum = Math.max(weights[0] + weights[1] + weights[2], 1e-9);
  let reflected = 0;
  for (let channel = 0; channel < 3; channel++) {
    const transportScatter =
      column.rayleigh[channel] + column.aerosol[channel] * (1 - 0.46);
    const absorption = Math.max(
      0,
      column.aerosolExtinction[channel] - column.aerosol[channel],
    );
    const backscatter = 0.5 * transportScatter;
    const reflectance = backscatter / (1 + backscatter + absorption);
    reflected += reflectance * weights[channel];
  }
  return reflected / weightSum;
}

/**
 * The column above what a body shows from outside: a solid's whole
 * column, or for an envelope the gas above its visible deck — the tops
 * stand where the column above them is still thin, wherever the
 * model's "surface" pressure sits below.
 */
export function deckOpticalDepth(atmosphere: PlanetAtmosphere, bulk: PlanetBulk, surfaceExposure = 1): AirColumn {
  const column = atmosphereColumn(atmosphere, bulk, surfaceExposure);
  return atmosphere.class === 'hydrogen-helium' ? columnAbove(column, atmosphere, 0) : column;
}

/** The deepest a visible cloud top sits below the top of the
 *  scattering column: past this the gas above would hide the deck. */
const CLOUD_TOP_MAX_TAU = 0.3;

/**
 * Overlying gas follows the thermal column when one is supplied. Only
 * envelopes retain the visible-pressure-level surrogate: solid-world
 * decks may be obscured by the atmosphere above their actual altitude.
 */
export function columnAbove(column: AirColumn, atmosphere: PlanetAtmosphere, deckKm: number, thermal?: HydrostaticColumn | null): AirColumn {
  const gasAbove = thermal ? columnStateAt(thermal, deckKm * 1000).pressureFraction
    : Math.exp(-Math.max(0, deckKm) / Math.max(atmosphere.scaleHeightKm, 0.1));
  const aerosolAbove = Math.exp(
    -Math.max(0, deckKm) /
      Math.max(atmosphere.scaleHeightKm * column.aerosolScaleHeightRatio, 0.1),
  );
  const green =
    column.rayleigh[1] * gasAbove + column.aerosolExtinction[1] * aerosolAbove;
  const cap = atmosphere.class === 'hydrogen-helium' && green > 0 ? Math.min(1, CLOUD_TOP_MAX_TAU / green) : 1;
  const scale = (v: [number, number, number], factor: number): [number, number, number] => [
    v[0] * factor,
    v[1] * factor,
    v[2] * factor,
  ];
  return {
    rayleigh: scale(column.rayleigh, gasAbove * cap),
    aerosol: scale(column.aerosol, aerosolAbove * cap),
    aerosolExtinction: scale(column.aerosolExtinction, aerosolAbove * cap),
    aerosolScaleHeightRatio: column.aerosolScaleHeightRatio,
  };
}
