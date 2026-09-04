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
  if (!AEROSOL[atmosphere.class].surfaceSourced) return 1;
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
  const k = RAYLEIGH_TAU_GREEN_1BAR * column * RAYLEIGH_PER_BAR[atmosphere.class];
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
    AEROSOL[atmosphere.class];
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
  const { singleScatteringAlbedo } = AEROSOL[atmosphere.class];
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
    aerosolScaleHeightRatio: AEROSOL[atmosphere.class].scaleHeightRatio,
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
export function deckOpticalDepth(atmosphere: PlanetAtmosphere, bulk: PlanetBulk): AirColumn {
  const column = atmosphereColumn(atmosphere, bulk);
  return atmosphere.class === 'hydrogen-helium' ? columnAbove(column, atmosphere, 0) : column;
}

/** The deepest a visible cloud top sits below the top of the
 *  scattering column: past this the gas above would hide the deck. */
const CLOUD_TOP_MAX_TAU = 0.3;

/**
 * The column above a deck standing this high: the surface column
 * thinned by the scale height, but never deeper than a deck can be
 * seen through — under a hothouse the visible tops ride the top of
 * the haze, wherever the geometric deck was placed.
 */
export function columnAbove(column: AirColumn, atmosphere: PlanetAtmosphere, deckKm: number): AirColumn {
  const gasAbove = Math.exp(-deckKm / Math.max(atmosphere.scaleHeightKm, 0.1));
  const aerosolAbove = Math.exp(
    -deckKm /
      Math.max(atmosphere.scaleHeightKm * column.aerosolScaleHeightRatio, 0.1),
  );
  const green =
    column.rayleigh[1] * gasAbove + column.aerosolExtinction[1] * aerosolAbove;
  const cap = green > 0 ? Math.min(1, CLOUD_TOP_MAX_TAU / green) : 1;
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
