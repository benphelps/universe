import { atmosphericColumnProfile } from '../../universe/planet/thermodynamics';
import type { Characterization } from '../../universe/planet/types';
import type { HydrostaticColumn } from '../../universe/planet/hydrostaticColumn';

/** Dimensionless prescribed column, independent of renderer length units. */
export interface GasProfile { lapseRatio: number; capRatio: number }
export const ISOTHERMAL_GAS: GasProfile = { lapseRatio: 0, capRatio: 1 };

export function gasProfile(column: HydrostaticColumn | null): GasProfile {
  return column ? {
    lapseRatio: column.lapseKPerM * column.gasConstantJkgK / column.gravityMs2,
    capRatio: Math.min(1, column.capTemperatureK / column.surfaceTemperatureK),
  } : ISOTHERMAL_GAS;
}

export function bodyGasProfile(body: Characterization): GasProfile {
  return gasProfile(atmosphericColumnProfile(body.atmosphere, body.climate, body.bulk));
}

/** Pressure and density relative to the surface, at z/H(surface).
 * P/P0 is also the fraction of the hydrostatic column mass above z.
 * Density differs by T0/T and is the quantity integrated along a ray. */
export function gasState(profile: GasProfile = ISOTHERMAL_GAS, altitudeScaleHeights: number): [number, number] {
  const x = Math.max(0, altitudeScaleHeights), beta = profile.lapseRatio;
  if (beta <= 1e-6) { const p = Math.exp(-x); return [p, p]; }
  const cap = profile.capRatio;
  const temperature = Math.max(cap, 1 - beta * x);
  const capHeight = (1 - cap) / beta;
  const p = Math.exp(Math.log1p(-beta * Math.min(x, capHeight)) / beta - Math.max(x - capHeight, 0) / cap);
  return [p, p / temperature];
}

export const GAS_PROFILE_GLSL = /* glsl */ `
uniform vec2 uGasProfile; // lapse*R/g, Tcap/Tsurface
vec2 gasStateAt(float altitude) {
  float x = max(altitude, 0.0) / max(uScaleHeight, 1e-4);
  float beta = uGasProfile.x;
  if (beta <= 1e-6) return vec2(exp(-x));
  float cap = uGasProfile.y;
  float capHeight = (1.0 - cap) / beta;
  float fall = beta * min(x, capHeight);
  // Avoid cancellation at a ground observer only metres above datum.
  float logT = fall < 1e-3 ? -fall * (1.0 + 0.5 * fall) : log(1.0 - fall);
  float p = exp(logT / beta - max(x - capHeight, 0.0) / cap);
  return vec2(p, p / max(cap, 1.0 - beta * x));
}
float gasColumnAt(float altitude) { return gasStateAt(altitude).x; }
float gasDensityAt(float altitude) { return gasStateAt(altitude).y; }
`;
