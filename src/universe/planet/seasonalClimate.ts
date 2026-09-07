import { SIGMA_SB } from '../../core/physics/constants';
import type { Vec3 } from '../../core/math/vec3';
import { dailyMeanInsolation, forcingPeriodSeconds, incidentBeams, instantaneousInsolation, type PlanetForcing } from './illumination';
import { sphericalFieldAt } from './surfaceClimate';
import type { Characterization, PlanetRotation } from './types';
import type { SeasonalSurfaceResult } from './seasonalSurface';
import type { AnnualMeanResult } from './annualMean';

export interface SeasonalClimateInput {
  /** A seasonal snow overlay is useful only on water-bearing, non-global-ice ground. */
  surfaceOverlay?: boolean;
  forcing: PlanetForcing;
  rotation: PlanetRotation;
  albedo: number;
  opticalDepth: number;
  internalWm2: number;
  pressureBar: number;
  /** Lumped sensible heat capacity per unit surface area, J/(m² K).
   * Fixed phases, no latent heat, conduction profile or evolving mixed layer. */
  heatCapacityJm2K: number;
  referenceMeanK: number;
}

export type SeasonalUnavailable = 'no-surface' | 'missing-forcing' | 'multiple-periods' | 'slow-rotation' | 'extreme-regime' | 'not-converged' | 'worker-failed';
export interface SeasonalCycle {
  /** Immutable worker-prepared mean, separate from coarse time frames. */
  annualMean?: AnnualMeanResult;
  surface?: SeasonalSurfaceResult;
  latitudeCount: number;
  longitudeCount: number;
  frameCount: number;
  /** Frame-major temperatures: equal-area cells followed by exact south
   * and north polar samples (zero area weight). Even times start at t=0.
   * The last interval wraps continuously to the first frame. */
  temperatureK: Float32Array;
  /** Actual midpoint beam directions/flux: x,y,z,W/m². A compact schedule
   * permits accurate focused-point queries across a sharp terminator. */
  forcingSamples: Float64Array;
  albedo: number;
  emissionCoefficient: number;
  redistribution: number;
  cycleSeconds: number;
  mode: 'rotation-averaged' | 'spin-resolved';
  heatCapacityJm2K: number;
  /** Coarse equal-area grid diagnostics, not bounds for arbitrary points. */
  meanK: number;
  minimumK: number;
  maximumK: number;
  diagnostics: {
    steps: number;
    iterations: number;
    maxSeamK: number;
    absorbedWm2: number;
    internalWm2: number;
    emittedWm2: number;
    storageWm2: number;
    /** Includes the nonlinear step residual, not just algebraic storage. */
    energyResidualWm2: number;
    maxStepResidualWm2: number;
  };
}
export type SeasonalResult = { status: 'ready'; cycle: SeasonalCycle } | { status: 'unavailable'; reason: SeasonalUnavailable };

/** Cheap request recipe. No cycle solve during system/neighbor generation.
 * One metre of rock (2 MJ/m²/K) and ten metres of liquid water (41.8 MJ/m²/K)
 * are explicit effective reservoirs, mixed by the global ocean fraction.
 * Add the finalized atmosphere's cp P/g. This is a dry sensible-heat EBM,
 * not a calibrated ocean, soil or meteorological column model. */
export function seasonalClimateInput(body: Characterization): SeasonalClimateInput | SeasonalUnavailable {
  if (body.appearance.banding || body.climate.hydrosphere === 'magma' || !body.climate.surfaceField) return 'no-surface';
  if (!body.forcing) return 'missing-forcing';
  const { atmosphere: air, climate, bulk } = body;
  const wet = climate.hydrosphere === 'oceans' ? climate.oceanCoverage : 0;
  const atmosphereCapacity = (air.specificHeatJkgK ?? 1000) * air.surfacePressureBar * 1e5 / bulk.gravityMs2;
  return {
    surfaceOverlay: climate.hydrosphere === 'oceans',
    forcing: body.forcing, rotation: body.rotation, albedo: climate.bondAlbedo,
    opticalDepth: air.opticalDepth, internalWm2: body.interior.heatFluxWm2,
    pressureBar: air.surfacePressureBar, referenceMeanK: climate.surfaceMeanK,
    heatCapacityJm2K: (1 - wet) * 2e6 + wet * 41.8e6 + atmosphereCapacity,
  };
}

/** A periodic cycle is only valid for commensurate forcing. Do not wrap
 * arbitrary binaries, lunar trajectories or slowly drifting stellar days
 * at the planet's year and manufacture a seam. Those retain annual data. */
export function seasonalSupport(input: SeasonalClimateInput): SeasonalUnavailable | null {
  const { forcing: f, rotation: r } = input;
  if (f.sources.length !== 1 || f.sources[0].path.length || f.origin.length || f.satellite) return 'multiple-periods';
  if (!Object.values(f.orbit.elements).every(Number.isFinite) || !Number.isFinite(f.orbit.mu) || f.orbit.mu <= 0 ||
    f.orbit.elements.semiMajorAxis <= 0 || !Number.isFinite(f.sources[0].luminositySolar) || f.sources[0].luminositySolar < 0) return 'extreme-regime';
  if (![input.albedo, input.opticalDepth, input.internalWm2, input.pressureBar, input.heatCapacityJm2K,
    input.referenceMeanK, r.periodHours, r.obliquityRad].every(Number.isFinite) ||
    input.albedo < 0 || input.albedo >= 1 || input.opticalDepth < 0 || input.internalWm2 < 0 ||
    input.pressureBar < 0 || input.pressureBar > 10 || input.heatCapacityJm2K <= 0 ||
    input.referenceMeanK < 30 || input.referenceMeanK > 1000 || r.periodHours <= 0 ||
    f.orbit.elements.eccentricity < 0 || f.orbit.elements.eccentricity > 0.8) return 'extreme-regime';
  const year = forcingPeriodSeconds(f), spin = r.periodHours * 3600;
  if (!(year > 0 && Number.isFinite(year))) return 'extreme-regime';
  if ((r.locked && r.lockTarget !== 'planet') || r.spinOrbitResonance === '3:2') {
    const expected = r.spinOrbitResonance === '3:2' ? 2 / 3 : 1;
    return Math.abs(spin / year - expected) < 1e-8 ? null : 'slow-rotation';
  }
  const retrograde = Math.cos(r.obliquityRad) < 0;
  const day = 1 / Math.abs((retrograde ? -1 : 1) / spin - 1 / year);
  const relaxation = input.heatCapacityJm2K * (1 + 0.75 * input.opticalDepth) / (4 * SIGMA_SB * input.referenceMeanK ** 3);
  return day <= Math.min(year / 32, relaxation / 8) ? null : 'slow-rotation';
}

/** Positive, monotone implicit sensible-heat step:
 * C(T1-T0)/dt = input - sigma T1^4 / greenhouse.
 * Convex scalar root, bounded iterations; backward Euler is deliberately
 * used for cold/airless stiff limits. Time refinement measures its lag. */
export function thermalStorageStep(t0: number, incomingWm2: number, dtOverCapacity: number, emissionCoefficient: number): number {
  const rhs = t0 + dtOverCapacity * incomingWm2, a = dtOverCapacity * emissionCoefficient;
  if (a === 0) return rhs;
  let t = Math.min(rhs, Math.sqrt(Math.sqrt(rhs / a)));
  for (let i = 0; i < 12; i++) {
    const t3 = t * t * t;
    const delta = (t + a * t3 * t - rhs) / (1 + 4 * a * t3);
    t -= delta;
    if (Math.abs(delta) < 1e-10) break;
  }
  return t;
}

/** Focus-only dry seasonal cycle. Preserves the annual model's prescribed
 * global redistribution of absorbed power: its area sum is exactly zero.
 * Nonlinear sensible heat storage is solved to a periodic boundary using
 * a safeguarded shooting Newton step (analytic cycle sensitivity).
 * The stored annual terrain proxy is never mutated by this higher tier. */
export function buildSeasonalCycle(input: SeasonalClimateInput, options: { latitudeCount?: number; steps?: number } = {}): SeasonalResult {
  const unsupported = seasonalSupport(input);
  if (unsupported) return { status: 'unavailable', reason: unsupported };
  const ny = options.latitudeCount ?? 12;
  const steps = options.steps ?? (input.forcing.orbit.elements.eccentricity > 0.6 ? 768 : 384);
  if (!Number.isInteger(ny) || ny < 2 || ny > 48 || !Number.isInteger(steps) || steps < 16 || steps > 3072) throw new RangeError('Seasonal grid exceeds its bounded resolution');
  const resolved = (input.rotation.locked && input.rotation.lockTarget !== 'planet') || input.rotation.spinOrbitResonance === '3:2';
  const nx = resolved ? 2 * ny : 1, areaCells = ny * nx, cells = areaCells + 2;
  const stride = Math.ceil(steps / 192), frameCount = Math.ceil(steps / stride);
  if (steps * cells > 2_000_000 || steps % stride) throw new RangeError('Seasonal grid exceeds its memory budget or frame stride');
  const cycleSeconds = forcingPeriodSeconds(input.forcing) * (input.rotation.spinOrbitResonance === '3:2' ? 2 : 1);
  const dt = cycleSeconds / steps, stepC = dt / input.heatCapacityJm2K;
  const emit = SIGMA_SB / (1 + 0.75 * input.opticalDepth), transport = -Math.expm1(-input.pressureBar);
  const power = new Float64Array(steps * cells), means = new Float64Array(cells);
  const forcingSamples = new Float64Array(steps * 4);
  const lo = new Float64Array(cells).fill(Infinity), hi = new Float64Array(cells);
  const normals: Vec3[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const y = -1 + 2 * (j + 0.5) / ny, radius = Math.sqrt(1 - y * y), phi = 2 * Math.PI * (i + 0.5) / nx;
    normals.push({ x: radius * Math.cos(phi), y, z: radius * Math.sin(phi) });
  }
  normals.push({x:0,y:-1,z:0},{x:0,y:1,z:0});
  let absorbedWm2 = 0;
  for (let k = 0; k < steps; k++) {
    const beams = incidentBeams(input.forcing, input.rotation, (k + 0.5) * dt);
    forcingSamples.set([beams[0].direction.x,beams[0].direction.y,beams[0].direction.z,beams[0].fluxWm2],k*4);
    const mean = beams.reduce((s, b) => s + b.fluxWm2 / 4, 0);
    absorbedWm2 += (1 - input.albedo) * mean / steps;
    let sum = 0;
    for (let c = 0; c < cells; c++) {
      const flux = resolved ? instantaneousInsolation(normals[c], beams) : dailyMeanInsolation(normals[c].y, beams);
      power[k * cells + c] = flux; if (c < areaCells) sum += flux;
    }
    const normalization = sum > 0 ? mean * areaCells / sum : 0;
    for (let c = 0; c < cells; c++) {
      const f = (1 - input.albedo) * ((1 - transport) * power[k * cells + c] * normalization + transport * mean) + input.internalWm2;
      power[k * cells + c] = f; means[c] += f / steps;
      lo[c] = Math.min(lo[c], f); hi[c] = Math.max(hi[c], f);
    }
  }
  const initial = means.map(f => (f / emit) ** 0.25);
  const lower = lo.map(f => (f / emit) ** 0.25), upper = hi.map(f => (f / emit) ** 0.25);
  const end = new Float64Array(cells), logSlope = new Float64Array(cells);
  let iterations = 0, maxSeamK = Infinity;
  for (; iterations < 24; iterations++) {
    end.set(initial); logSlope.fill(0);
    for (let k = 0; k < steps; k++) for (let c = 0; c < cells; c++) {
      const t = thermalStorageStep(end[c], power[k * cells + c], stepC, emit);
      end[c] = t; logSlope[c] -= Math.log1p(4 * stepC * emit * t ** 3);
    }
    maxSeamK = 0;
    for (let c = 0; c < cells; c++) maxSeamK = Math.max(maxSeamK, Math.abs(end[c] - initial[c]));
    if (maxSeamK < 1e-5) break;
    for (let c = 0; c < cells; c++) {
      const diff = end[c] - initial[c];
      if (diff > 0) lower[c] = initial[c]; else upper[c] = initial[c];
      const correction = diff / -Math.expm1(logSlope[c]);
      const candidate = initial[c] + correction;
      initial[c] = Number.isFinite(candidate) && candidate >= lower[c] && candidate <= upper[c]
        ? candidate : (lower[c] + upper[c]) / 2;
    }
  }
  if (maxSeamK >= 1e-5) return { status: 'unavailable', reason: 'not-converged' };
  // At most 192 frames retained; higher step counts improve the solve but
  // do not enlarge the display cache without bound.
  const temperatureK = new Float32Array(frameCount * cells);
  let meanK = 0, minimumK = Infinity, maximumK = 0, emittedWm2 = 0, maxStepResidualWm2 = 0;
  end.set(initial);
  for (let k = 0; k < steps; k++) {
    if (k % stride === 0) temperatureK.set(end, k / stride * cells);
    for (let c = 0; c < cells; c++) {
      const before = end[c], f = power[k * cells + c];
      const t = thermalStorageStep(before, f, stepC, emit);
      const outgoing = emit * t ** 4, storage = (t - before) / stepC;
      maxStepResidualWm2 = Math.max(maxStepResidualWm2, Math.abs(f - outgoing - storage));
      if (c < areaCells) { emittedWm2 += outgoing / (steps * areaCells); meanK += t / (steps * areaCells); }
      minimumK = Math.min(minimumK, t); maximumK = Math.max(maximumK, t); end[c] = t;
    }
  }
  const storageWm2 = end.reduce((s, t, c) => s + (c < areaCells ? input.heatCapacityJm2K * (t - initial[c]) / cycleSeconds / areaCells : 0), 0);
  return { status: 'ready', cycle: { latitudeCount: ny, longitudeCount: nx, frameCount, temperatureK, forcingSamples,
    albedo:input.albedo,emissionCoefficient:emit,redistribution:transport,cycleSeconds,
    mode: resolved ? 'spin-resolved' : 'rotation-averaged', heatCapacityJm2K: input.heatCapacityJm2K,
    meanK, minimumK, maximumK, diagnostics: { steps, iterations: iterations + 1, maxSeamK,
      absorbedWm2, internalWm2: input.internalWm2, emittedWm2, storageWm2,
      energyResidualWm2: absorbedWm2 + input.internalWm2 - emittedWm2 - storageWm2, maxStepResidualWm2 } } };
}

export interface SeasonalPointCycle { temperatureK: Float64Array; cycleSeconds: number }

/** Solve the actual point direction, avoiding interpolation of hot dayside
 * cells into an unilluminated terminator. Intended for a cached inspection
 * point, not every terrain vertex, image pixel or animation frame.
 * Uses unscaled physical beams; the coarse map's angular normalization is
 * a finite-grid energy correction and must not bias this point solve. */
export function seasonalPointCycle(cycle: SeasonalCycle, dir: Vec3): SeasonalPointCycle | null {
  const steps = cycle.diagnostics.steps, power = new Float64Array(steps);
  const dtOverC = cycle.cycleSeconds / steps / cycle.heatCapacityJm2K, emit = cycle.emissionCoefficient;
  let lowPower = Infinity, highPower = 0, meanPower = 0;
  for (let k = 0; k < steps; k++) {
    const b = cycle.forcingSamples, direction = {x:b[k*4],y:b[k*4+1],z:b[k*4+2]}, fluxWm2 = b[k*4+3];
    const local = cycle.mode === 'rotation-averaged' ? dailyMeanInsolation(dir.y,[{direction,fluxWm2}])
      : fluxWm2 * Math.max(0,dir.x*direction.x+dir.y*direction.y+dir.z*direction.z);
    const f = (1-cycle.albedo)*((1-cycle.redistribution)*local+cycle.redistribution*fluxWm2/4)+cycle.diagnostics.internalWm2;
    power[k]=f; meanPower+=f/steps; lowPower=Math.min(lowPower,f); highPower=Math.max(highPower,f);
  }
  let initial=(meanPower/emit)**.25, lower=(lowPower/emit)**.25, upper=(highPower/emit)**.25;
  const temperatures=new Float64Array(steps);
  for(let iteration=0;iteration<24;iteration++) {
    let t=initial,logSlope=0;
    for(let k=0;k<steps;k++) {
      temperatures[k]=t;t=thermalStorageStep(t,power[k],dtOverC,emit);
      logSlope-=Math.log1p(4*dtOverC*emit*t**3);
    }
    const diff=t-initial;
    if(Math.abs(diff)<1e-5)return {temperatureK:temperatures,cycleSeconds:cycle.cycleSeconds};
    if(diff>0)lower=initial;else upper=initial;
    const candidate=initial+diff/-Math.expm1(logSlope);
    initial=Number.isFinite(candidate)&&candidate>=lower&&candidate<=upper?candidate:(lower+upper)/2;
  }
  return null;
}

export function seasonalPointTemperatureAt(point: SeasonalPointCycle, timeSeconds: number): number {
  const n=point.temperatureK.length,phase=((timeSeconds/point.cycleSeconds)%1+1)%1*n,k=Math.floor(phase),f=phase-k;
  return point.temperatureK[k]*(1-f)+point.temperatureK[(k+1)%n]*f;
}

export function seasonalCycleBytes(cycle: SeasonalCycle): number {
  const mean = cycle.annualMean?.status === 'ready' ? cycle.annualMean.field : null;
  return cycle.temperatureK.byteLength + cycle.forcingSamples.byteLength +
    (mean ? mean.angles.byteLength + mean.ratios.byteLength + mean.fourthK4.byteLength : 0) +
    (cycle.surface?.status === 'ready' ? cycle.surface.field.temperatureK.byteLength : 0);
}

/** Coarse diagnostic map only: unresolved synchronous terminators can have
 * large interpolation errors. Use seasonalPointCycle for inspected local
 * temperatures. No terrain, frost or detector consumes this coarse map. */
export function seasonalGridTemperatureAt(cycle: SeasonalCycle, dir: Vec3, timeSeconds: number): number {
  const phase = ((timeSeconds / cycle.cycleSeconds) % 1 + 1) % 1 * cycle.frameCount;
  const frame = Math.floor(phase), f = phase - frame, cells = cycle.latitudeCount * cycle.longitudeCount + 2;
  const sample = (k: number) => sphericalFieldAt(cycle.temperatureK, cycle.latitudeCount, cycle.longitudeCount, dir, k * cells,
    cycle.temperatureK[(k + 1) * cells - 2],cycle.temperatureK[(k + 1) * cells - 1]);
  return sample(frame) * (1 - f) + sample((frame + 1) % cycle.frameCount) * f;
}
