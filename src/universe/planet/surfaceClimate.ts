import { ANNUAL_INSOLATION_TABLE } from './annualInsolationTable';
import { annualBeamField, annualBeamFluxAt, type AnnualBeamField } from './annualBeamField';
import { SOLAR_LUMINOSITY, SIGMA_SB } from '../../core/physics/constants';
import type { Vec3 } from '../../core/math/vec3';
import { dailyMeanInsolation, forcingPeriodSeconds, incidentBeams, type IncidentBeam, type PlanetForcing } from './illumination';
import type { PlanetRotation } from './types';
import { annualMeanTemperatureAt, type AnnualMeanField } from './annualMeanField';

export interface InsolationField {
  latitudeCount: number;
  longitudeCount: number;
  fluxWm2: Float64Array;
  meanFluxWm2: number;
  /** Rotational climatology for non-resonant bodies, resolved longitude for locks/resonances. */
  mode: 'rotation-averaged' | 'spin-resolved';
  averagingSeconds: number;
  beamField?: AnnualBeamField;
  southPoleFluxWm2?: number;
  northPoleFluxWm2?: number;
}
export interface SurfaceTemperatureField {
  /** Completed dry seasonal temperature mean for persistent consumers.
   * Power diagnostics remain the radiative annual ledger. */
  annualMean?: AnnualMeanField;
  latitudeCount: number;
  longitudeCount: number;
  /** Coarse equal-area diagnostics. Resolved local queries use the actual
   * clipped beam field, not interpolation across its terminator. */
  fourthK4: Float64Array;
  /** Spatial mean of the installed temperature recipe. Catalog fields use
   * equilibrium under mean forcing; annualMean supplies a seasonal mean. */
  meanK: number;
  minimumK: number;
  maximumK: number;
  iceFraction: number;
  meanAbsorbedWm2: number;
  /** Outgoing power integrated on the finite equal-area diagnostic grid. */
  meanOutgoingWm2: number;
  /** Analytic intercepted + internal budget, separate from quadrature error. */
  expectedMeanOutgoingWm2?: number;
  beamField?: AnnualBeamField;
  beamFourthPerWm2?: number;
  backgroundFourthK4?: number;
  southPoleFourthK4?: number;
  northPoleFourthK4?: number;
  redistribution: number;
  mode: InsolationField['mode'];
}

/** Uniform time quadrature and equal-area latitude/longitude cells.
 * All sources are sampled over the host year (two for a 3:2 resonance).
 * Noncommensurate stellar companions remain a finite-window estimate.
 * This static rotational climatology does not claim a resolved weather cycle. */
export function buildAnnualInsolation(forcing: PlanetForcing, rotation: PlanetRotation, latitudeCount = 12, samples = 24): InsolationField {
  const resolved = (rotation.locked && rotation.lockTarget !== 'planet') || rotation.spinOrbitResonance === '3:2';
  const longitudeCount = resolved ? latitudeCount * 2 : 1;
  const fluxWm2 = new Float64Array(latitudeCount * longitudeCount);
  const averagingSeconds = forcingPeriodSeconds(forcing) * (rotation.spinOrbitResonance === '3:2' ? 2 : 1);
  // A central source's r^-2 cancels Kepler's dt/dν ∝ r². Its
  // rotational annual shape depends only on the spin/orbit angle;
  // eccentricity sets the exact mean flux. No per-body orbit sampling.
  if (!resolved && !forcing.satellite && forcing.sources.length === 1 && forcing.origin.length === 0 &&
    forcing.sources[0].path.length === 0 && latitudeCount === 12) {
    const el = forcing.orbit.elements, tilt = rotation.obliquityRad;
    const dot = Math.sin(tilt) * Math.sin(el.longitudeOfAscendingNode) * Math.sin(el.inclination) +
      Math.cos(tilt) * Math.cos(el.inclination);
    const x = Math.acos(Math.min(1, Math.abs(dot))) * 128 / (Math.PI / 2);
    const row = Math.min(127, Math.floor(x)), f = x - row;
    const flux = forcing.sources[0].luminositySolar * SOLAR_LUMINOSITY /
      (4 * Math.PI * el.semiMajorAxis ** 2 * Math.sqrt(1 - el.eccentricity ** 2));
    for (let j = 0; j < latitudeCount; j++) {
      fluxWm2[j] = flux * (ANNUAL_INSOLATION_TABLE[row * 12 + j] * (1 - f) + ANNUAL_INSOLATION_TABLE[(row + 1) * 12 + j] * f);
    }
    const poleFlux = flux * Math.sqrt(Math.max(0, 1 - dot * dot)) / Math.PI;
    return { latitudeCount, longitudeCount, fluxWm2, meanFluxWm2: flux / 4, averagingSeconds,
      southPoleFluxWm2: poleFlux, northPoleFluxWm2: poleFlux, mode: 'rotation-averaged' };
  }
  const steps = Math.max(samples, forcing.orbit.elements.eccentricity > 0.7 ? 768 :
    resolved ? forcing.orbit.elements.eccentricity > 0.2 ? 192 : 96 : 0);
  const normals: Vec3[] = [];
  for (let j = 0; j < latitudeCount; j++) for (let i = 0; i < longitudeCount; i++) {
    const y = -1 + 2 * (j + 0.5) / latitudeCount, r = Math.sqrt(1 - y * y);
    const a = 2 * Math.PI * (i + 0.5) / longitudeCount;
    normals.push({ x: r * Math.cos(a), y, z: r * Math.sin(a) });
  }
  let meanFluxWm2 = 0;
  let southPoleFluxWm2 = 0, northPoleFluxWm2 = 0;
  const samplesBeams: IncidentBeam[] = [];
  for (let k = 0; k < steps; k++) {
    const beams = incidentBeams(forcing, rotation, (k + 0.5) / steps * averagingSeconds);
    meanFluxWm2 += beams.reduce((s, b) => s + b.fluxWm2 / 4, 0) / steps;
    if (resolved) samplesBeams.push(...beams);
    else for (let cell = 0; cell < normals.length; cell++) fluxWm2[cell] += dailyMeanInsolation(normals[cell].y, beams) / steps;
    southPoleFluxWm2 += dailyMeanInsolation(-1, beams) / steps;
    northPoleFluxWm2 += dailyMeanInsolation(1, beams) / steps;
  }
  const beamField = resolved ? annualBeamField(samplesBeams, 1 / steps) : undefined;
  if (beamField) for (let cell = 0; cell < normals.length; cell++) fluxWm2[cell] = annualBeamFluxAt(beamField, normals[cell]);
  // Never rescale the physical field to hide coarse angular quadrature
  // error. A sum of cosine-clipped beams already has exact sphere mean F/4.
  return { latitudeCount, longitudeCount, fluxWm2, meanFluxWm2, averagingSeconds,
    beamField, southPoleFluxWm2, northPoleFluxWm2,
    mode: resolved ? 'spin-resolved' : 'rotation-averaged' };
}

/** Conservative prescribed horizontal redistribution: redistribute a
 * fraction of absorbed stellar power globally, keeping internal heat separate.
 * It is a static gray energy balance, not a circulation/seasonal-inertia solve. */
export function annualSurfaceTemperatures(insolation: InsolationField, albedo: number, opticalDepth: number,
  internalWm2: number, pressureBar: number): SurfaceTemperatureField {
  const redistribution = -Math.expm1(-Math.max(0, pressureBar));
  const greenhouse = 1 + 0.75 * Math.max(0, opticalDepth);
  const absorbed = (1 - albedo) * insolation.meanFluxWm2;
  const fourthK4 = new Float64Array(insolation.fluxWm2.length);
  const beamFourthPerWm2 = (1 - redistribution) * (1 - albedo) * greenhouse / SIGMA_SB;
  const backgroundFourthK4 = (redistribution * absorbed + internalWm2) * greenhouse / SIGMA_SB;
  let meanK = 0, minimumK = Infinity, maximumK = 0, iceFraction = 0, outgoing = 0;
  for (let i = 0; i < fourthK4.length; i++) {
    const power = (1 - redistribution) * (1 - albedo) * insolation.fluxWm2[i] + redistribution * absorbed + internalWm2;
    const fourth = Math.max(0, power) * greenhouse / SIGMA_SB;
    fourthK4[i] = fourth;
    const t = Math.sqrt(Math.sqrt(fourth));
    meanK += t / fourthK4.length; minimumK = Math.min(minimumK, t); maximumK = Math.max(maximumK, t);
    // Same permanent-ice interval for global albedo and local ice inputs.
    iceFraction += Math.max(0, Math.min(1, (268 - t) / 10)) / fourthK4.length;
    outgoing += fourth * SIGMA_SB / greenhouse / fourthK4.length;
  }
  const southPoleFourthK4 = insolation.southPoleFluxWm2 === undefined ? undefined : insolation.southPoleFluxWm2 * beamFourthPerWm2 + backgroundFourthK4;
  const northPoleFourthK4 = insolation.northPoleFluxWm2 === undefined ? undefined : insolation.northPoleFluxWm2 * beamFourthPerWm2 + backgroundFourthK4;
  for (const fourth of [southPoleFourthK4, northPoleFourthK4]) if (fourth !== undefined) {
    const t = Math.sqrt(Math.sqrt(fourth)); minimumK = Math.min(minimumK, t); maximumK = Math.max(maximumK, t);
  }
  return { latitudeCount: insolation.latitudeCount, longitudeCount: insolation.longitudeCount,
    fourthK4, meanK, minimumK, maximumK, iceFraction, redistribution, meanAbsorbedWm2: absorbed,
    meanOutgoingWm2: outgoing, expectedMeanOutgoingWm2: absorbed + internalWm2,
    beamField: insolation.beamField, beamFourthPerWm2, backgroundFourthK4,
    southPoleFourthK4, northPoleFourthK4,
    mode: insolation.mode };
}

/** Physical resolved forcing preserves cold horizons and poles. Legacy
 * fields retain periodic interpolation; generated poles use their own flux. */
export function surfaceTemperatureAt(field: SurfaceTemperatureField, dir: Vec3): number {
  if (field.annualMean) return annualMeanTemperatureAt(field.annualMean, dir);
  let fourth = field.beamField
    ? annualBeamFluxAt(field.beamField, dir) * field.beamFourthPerWm2! + field.backgroundFourthK4!
    : sphericalFieldAt(field.fourthK4, field.latitudeCount, field.longitudeCount, dir, 0, field.southPoleFourthK4, field.northPoleFourthK4);
  if (!field.beamField && field.longitudeCount === 1 && Math.abs(dir.y) > 1 - 1 / field.latitudeCount) {
    const pole = dir.y < 0 ? field.southPoleFourthK4 : field.northPoleFourthK4;
    if (pole !== undefined) {
      const ring = field.fourthK4[dir.y < 0 ? 0 : field.latitudeCount - 1];
      // Near an upright pole, insolation approaches zero linearly in
      // angular distance, not in equal-area y = sin(latitude).
      const ringWeight = Math.acos(Math.min(1, Math.abs(dir.y))) / Math.acos(1 - 1 / field.latitudeCount);
      fourth = pole + (ring - pole) * ringWeight;
    }
  }
  return Math.sqrt(Math.sqrt(Math.max(0, fourth)));
}

/** Equal-area latitude interpolation, periodic longitude and continuous
 * polar caps. Offset permits sampling a cached time slice without copies. */
export function sphericalFieldAt(values: ArrayLike<number>, ny: number, nx: number, dir: Vec3, offset = 0, southPole?: number, northPole?: number): number {
  const rawY = (Math.max(-1, Math.min(1, dir.y)) + 1) * ny / 2 - 0.5;
  const y = Math.max(0, Math.min(ny - 1, rawY)), j = Math.floor(y), jy = Math.min(ny - 1, j + 1), fy = y - j;
  if (nx === 1) {
    let value = values[offset + j] * (1 - fy) + values[offset + jy] * fy;
    const pole = rawY < 0 ? southPole : rawY > ny - 1 ? northPole : undefined;
    if (pole !== undefined) value += (pole - value) * Math.min(1, 2 * Math.abs(rawY - y));
    return value;
  }
  const a = ((Math.atan2(dir.z, dir.x) / (2 * Math.PI) + 1) % 1) * nx - 0.5;
  const i0 = Math.floor(a), i = (i0 + nx) % nx, ix = (i + 1) % nx, fx = a - i0;
  const row = (r: number) => values[offset + r * nx + i] * (1 - fx) + values[offset + r * nx + ix] * fx;
  let fourth = row(j) * (1 - fy) + row(jy) * fy;
  if (nx > 1 && (rawY < 0 || rawY > ny - 1)) {
    const r = rawY < 0 ? 0 : ny - 1;
    let average = 0; for (let c = 0; c < nx; c++) average += values[offset + r * nx + c] / nx;
    average = (rawY < 0 ? southPole : northPole) ?? average;
    const blend = Math.min(1, 2 * Math.abs(rawY - y));
    fourth += (average - fourth) * blend;
  }
  return fourth;
}
