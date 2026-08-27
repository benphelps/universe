/**
 * Shader clocks fold into this window: small enough that every phase a
 * shader derives from it (drift, churn, winding, granulation) stays
 * within float32 precision, large enough that a fold lands inside one
 * deck crossfade or one statistical shuffle and passes unseen. CPU-side
 * time stays float64 and unfolded — storms, fades, and orbits keep
 * their absolute clock.
 */
export const SHADER_TIME_FOLD = 512;

/** Sim time folded for shader upload; period in the caller's time unit. */
export function foldShaderTime(t: number, period = SHADER_TIME_FOLD): number {
  const folded = t % period;
  return folded < 0 ? folded + period : folded;
}
