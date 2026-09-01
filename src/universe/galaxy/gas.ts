import { PARSEC, PROTON_MASS, SOLAR_MASS } from '../../core/physics/constants';
import {
  cloudDustDensity,
  cloudHalfExtentsPc,
  cloudStretch,
  cloudStretchAxis,
  cloudVolumePc3,
  type MolecularCloud,
} from './clouds';
import { DUST_OPACITY_PER_PC } from './density';

/**
 * The gas behind the dust.
 *
 * The density model carries dust, not gas: the field is dimensionless
 * and `DUST_OPACITY_PER_PC` is what makes it physical — unit density is
 * 0.045 optical depths per parsec, which at the solar circle comes out
 * at the magnitude of visual extinction per kiloparsec the sky
 * actually shows. Recombination physics needs hydrogen, so the
 * conversion lives here and nowhere else: optical depth → A_V → the
 * standard dust-to-gas column ratio → cm⁻³.
 */

/** Optical depth to magnitudes, 2.5 log₁₀ e. */
export const AV_PER_TAU = 2.5 / Math.LN10;
/** N(H)/A_V at R_V = 3.1 (Bohlin, Savage & Drake), cm⁻² mag⁻¹. */
export const HYDROGEN_PER_AV = 1.87e21;
/** Gas mass per hydrogen nucleus, in proton masses — helium included. */
export const MASS_PER_HYDROGEN = 1.4;

const CM_PER_PC = PARSEC * 100;
/** Solar masses in one cm⁻³ of hydrogen filling one cubic parsec. */
const SOLAR_MASSES_PER_UNIT =
  (CM_PER_PC ** 3 * MASS_PER_HYDROGEN * PROTON_MASS) / SOLAR_MASS;

/** Hydrogen nuclei per cm³ behind one unit of dust density at solar
 *  dust-to-gas — the whole bridge, in one number. */
export const HYDROGEN_PER_DUST =
  (HYDROGEN_PER_AV * AV_PER_TAU * DUST_OPACITY_PER_PC) / CM_PER_PC;

/** Dust-to-gas ratio against solar: dust is made of the metals, so a
 *  metal-poor cloud hides more gas behind the same extinction. */
export function dustToGas(feH: number): number {
  return 10 ** feH;
}

/** Hydrogen number density behind a dust density, cm⁻³. */
export function hydrogenDensity(dust: number, feH = 0): number {
  return (HYDROGEN_PER_DUST * dust) / dustToGas(feH);
}

/** A cloud's hydrogen density at a point in its own frame, cm⁻³. */
export function cloudHydrogenDensity(
  cloud: MolecularCloud,
  rxPc: number,
  ryPc: number,
  rzPc: number,
  feH = 0,
): number {
  return hydrogenDensity(cloudDustDensity(cloud, rxPc, ryPc, rzPc), feH);
}

/**
 * The gas the cloud holds, M☉: its own field integrated over the box
 * that bounds it. Coarse on purpose — the answer is a population
 * statistic, not a per-frame quantity.
 */
export function cloudMassSolar(cloud: MolecularCloud, feH = 0, samples = 24): number {
  const half = cloudHalfExtentsPc(cloud);
  const cellPc3 = ((2 * half[0]) / samples) * ((2 * half[1]) / samples) * ((2 * half[2]) / samples);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const x = -half[0] + ((i + 0.5) / samples) * 2 * half[0];
    for (let j = 0; j < samples; j++) {
      const y = -half[1] + ((j + 0.5) / samples) * 2 * half[1];
      for (let k = 0; k < samples; k++) {
        const z = -half[2] + ((k + 0.5) / samples) * 2 * half[2];
        sum += cloudHydrogenDensity(cloud, x, y, z, feH);
      }
    }
  }
  return sum * cellPc3 * SOLAR_MASSES_PER_UNIT;
}

/** Mean hydrogen density over the body observations would call the
 *  cloud, cm⁻³ — what catalogues quote against M/(4/3 π R³). */
export function cloudMeanHydrogenDensity(cloud: MolecularCloud, feH = 0): number {
  return cloudMassSolar(cloud, feH) / (cloudVolumePc3(cloud) * SOLAR_MASSES_PER_UNIT);
}

/** Mass per unit projected area, M☉ pc⁻² — Larson's ~100 for a GMC. */
export function cloudSurfaceDensity(cloud: MolecularCloud, feH = 0): number {
  // The nominal body seen across its drawn-out axis: π r · r·stretch.
  const area = Math.PI * cloud.radiusPc ** 2 * cloudStretch(cloud);
  return cloudMassSolar(cloud, feH) / area;
}

/**
 * Visual extinction straight through the cloud's centre, magnitudes:
 * the sightline a dark cloud is actually measured by. Crossing the
 * short way, so a drawn-out cloud is quoted across rather than along.
 */
export function cloudCentralExtinction(cloud: MolecularCloud, steps = 256): number {
  const half = cloudHalfExtentsPc(cloud);
  const axis = (cloudStretchAxis(cloud) + 1) % 3;
  const reach = half[axis];
  const step = (2 * reach) / steps;
  let tau = 0;
  for (let i = 0; i < steps; i++) {
    const t = -reach + (i + 0.5) * step;
    tau +=
      cloudDustDensity(cloud, axis === 0 ? t : 0, axis === 1 ? t : 0, axis === 2 ? t : 0) *
      DUST_OPACITY_PER_PC *
      step;
  }
  return tau * AV_PER_TAU;
}
