/** Mean transmission from uniformly emitting material inside a cell.
 * Multiplying j Δs by this integrates dI/ds = j - κI exactly for
 * constant j and κ. A foreground screen alone does not attenuate the
 * emission's path through its own cell. */
export function cellEmissionWeight(opticalDepth: number): number {
  return opticalDepth > 0 ? -Math.expm1(-opticalDepth) / opticalDepth : 1;
}

/** Same solution in single precision. The series avoids cancellation
 * in 1-exp(-τ) near zero; through τ⁴ the truncation error is
 * below 1.4e-8 for τ < 0.1, beneath single-precision rounding. */
export const CELL_TRANSFER_GLSL = /* glsl */ `
float cellEmissionWeight(float tau) {
  if (tau < 0.1) return 1.0 + tau * (-0.5 + tau * (1.0 / 6.0 + tau * (-1.0 / 24.0 + tau / 120.0)));
  return (1.0 - exp(-tau)) / tau;
}
// A marcher that updates running transmission already has exp(-τ).
// Reuse it, while retaining the cancellation-safe small-cell series.
float cellEmissionWeight(float tau, float transmission) {
  if (tau < 0.1) return 1.0 + tau * (-0.5 + tau * (1.0 / 6.0 + tau * (-1.0 / 24.0 + tau / 120.0)));
  return (1.0 - transmission) / tau;
}
vec3 cellEmissionWeight(vec3 tau) {
  return vec3(cellEmissionWeight(tau.r), cellEmissionWeight(tau.g), cellEmissionWeight(tau.b));
}
vec3 cellEmissionWeight(vec3 tau, vec3 transmission) {
  return vec3(cellEmissionWeight(tau.r, transmission.r), cellEmissionWeight(tau.g, transmission.g), cellEmissionWeight(tau.b, transmission.b));
}
`;
