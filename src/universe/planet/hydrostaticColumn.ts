/** Ideal-gas, constant-gravity column with a prescribed linear lapse
 * followed by an isothermal cap. Hydrostatics is solved analytically;
 * this is not a radiative-convective or chemical equilibrium solve. */
export interface HydrostaticColumn {
  surfacePressurePa: number;
  surfaceTemperatureK: number;
  capTemperatureK: number;
  gasConstantJkgK: number;
  gravityMs2: number;
  lapseKPerM: number;
}

export interface ColumnState {
  temperatureK: number;
  pressurePa: number;
  densityKgM3: number;
  /** Hydrostatic gas mass above this altitude, kg/m². */
  massAboveKgM2: number;
  pressureFraction: number;
}

/** Cheap thermal branch shared with terrain; no pressure solve per vertex. */
export function columnTemperatureK(surfaceK: number, capK: number, lapseKPerM: number, altitudeM: number): number {
  return Math.max(Math.min(surfaceK, capK), surfaceK - lapseKPerM * Math.max(0, altitudeM));
}

export function columnStateAt(column: HydrostaticColumn, altitudeM: number): ColumnState {
  const { surfaceTemperatureK: t0, gasConstantJkgK: gasR, gravityMs2: g } = column;
  const cap = Math.min(t0, column.capTemperatureK), lapse = column.lapseKPerM;
  const z = Math.max(0, altitudeM);
  const tropopause = lapse > 0 ? (t0 - cap) / lapse : 0;
  const temperatureK = columnTemperatureK(t0, cap, lapse, z);
  let logPressure: number;
  if (lapse <= 0) logPressure = -g * z / (gasR * t0);
  else {
    // log1p preserves the surface limit for very small altitude/lapse.
    logPressure = g / (gasR * lapse) * Math.log1p(-lapse * Math.min(z, tropopause) / t0);
    if (z > tropopause) logPressure -= g * (z - tropopause) / (gasR * cap);
  }
  const pressureFraction = Math.exp(logPressure), pressurePa = column.surfacePressurePa * pressureFraction;
  return { temperatureK, pressurePa, pressureFraction, densityKgM3: pressurePa / (gasR * temperatureK), massAboveKgM2: pressurePa / g };
}

/** Exact inverse pressure coordinate, useful for fixed pressure layers. */
export function columnAltitudeAtPressureFraction(column: HydrostaticColumn, fraction: number): number {
  const { surfaceTemperatureK: t0, gasConstantJkgK: gasR, gravityMs2: g, lapseKPerM: lapse } = column;
  const logFraction = Math.log(Math.max(Number.MIN_VALUE, Math.min(1, fraction)));
  if (lapse <= 0) return -logFraction * gasR * t0 / g;
  const cap = Math.min(t0, column.capTemperatureK), tropopause = (t0 - cap) / lapse;
  const capLogPressure = g / (gasR * lapse) * Math.log(cap / t0);
  return logFraction >= capLogPressure
    ? -t0 / lapse * Math.expm1(logFraction * gasR * lapse / g)
    : tropopause + (capLogPressure - logFraction) * gasR * cap / g;
}

export function sampleHydrostaticColumn(column: HydrostaticColumn, layers = 32, topPressureFraction = 1e-6) {
  if (!Number.isInteger(layers) || layers < 1 || !(topPressureFraction > 0 && topPressureFraction < 1)) {
    throw new RangeError('Expected positive layers and a top pressure fraction between zero and one');
  }
  const altitudeM = new Float64Array(layers + 1), temperatureK = new Float64Array(layers + 1), pressurePa = new Float64Array(layers + 1);
  const densityKgM3 = new Float64Array(layers + 1), massAboveKgM2 = new Float64Array(layers + 1);
  const massKgM2 = new Float64Array(layers);
  for (let i = 0; i <= layers; i++) {
    const fraction = topPressureFraction ** (i / layers);
    altitudeM[i] = columnAltitudeAtPressureFraction(column, fraction);
    const state = columnStateAt(column, altitudeM[i]);
    temperatureK[i] = state.temperatureK; pressurePa[i] = state.pressurePa;
    densityKgM3[i] = state.densityKgM3; massAboveKgM2[i] = state.massAboveKgM2;
    if (i > 0) massKgM2[i - 1] = (pressurePa[i - 1] - pressurePa[i]) / column.gravityMs2;
  }
  return { altitudeM, temperatureK, pressurePa, densityKgM3, massAboveKgM2, massKgM2 };
}
