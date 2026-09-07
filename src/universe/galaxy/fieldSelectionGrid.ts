/** Positive cumulative RGB light over age probability and system optical
 * power. Axes include exact empty/full boundaries; interpolation cannot
 * create negative residual light. Generated offline, read only for sky bakes. */
export const SELECTION_AGE_BINS = 64;
export const SELECTION_POWER_BINS = 96;
export const SELECTION_MIN_LOG_POWER = -12;
export const SELECTION_MAX_LOG_POWER = 7;
export const SELECTION_AGE_CURVE = 6;
export function selectionAgeAt(index: number): number {
  return Math.expm1(index/SELECTION_AGE_BINS*SELECTION_AGE_CURVE)/Math.expm1(SELECTION_AGE_CURVE);
}
export function selectionAgeIndex(unit: number): number {
  return Math.log1p(Math.max(0,Math.min(1,unit))*Math.expm1(SELECTION_AGE_CURVE))/SELECTION_AGE_CURVE*SELECTION_AGE_BINS;
}
export function selectionPowerIndex(power: number): number {
  return Math.max(0, Math.min(SELECTION_POWER_BINS, (Math.log10(Math.max(1e-30,power))-SELECTION_MIN_LOG_POWER)/(SELECTION_MAX_LOG_POWER-SELECTION_MIN_LOG_POWER)*SELECTION_POWER_BINS));
}
export const FIELD_COMPONENTS = ['thin-disk','thick-disk','halo','bulge'] as const;
export const FIELD_ROW_BOUNDS = [.013,.91,2.2,7,120] as const;
