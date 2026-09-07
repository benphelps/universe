/** Pure ordinary water phase boundaries. IAPWS R14-08(2011), eq. 6
 * (ice Ih, 50–273.16 K), and SR1-86(1992), eq. 1 (liquid, triple to
 * critical point). No salinity, high-pressure ice or nonideal gas fit.
 * https://iapws.org/documents/release/MeltSub.download
 * https://srd.nist.gov/jpcrdreprint/1.555926.pdf */
export const WATER_TRIPLE_K = 273.16;
export const WATER_TRIPLE_PA = 611.657;
export const WATER_CRITICAL_K = 647.096;
export const WATER_CRITICAL_PA = 22.064e6;

/** Null means outside the curve's supported temperature range. */
export function waterSaturationPa(temperatureK: number): number | null {
  if (!(temperatureK >= 50 && temperatureK <= WATER_CRITICAL_K)) return null;
  if (temperatureK < WATER_TRIPLE_K) {
    const theta = temperatureK / WATER_TRIPLE_K;
    return WATER_TRIPLE_PA * Math.exp((-21.2144006 * theta ** 0.00333333333
      + 27.3203819 * theta ** 1.20666667 - 6.1059813 * theta ** 1.70333333) / theta);
  }
  const tau = 1 - temperatureK / WATER_CRITICAL_K;
  return WATER_CRITICAL_PA * Math.exp(WATER_CRITICAL_K / temperatureK *
    (-7.85951783 * tau + 1.84408259 * tau ** 1.5 - 11.7866497 * tau ** 3
      + 22.6807411 * tau ** 3.5 - 15.9618719 * tau ** 4 + 1.80122502 * tau ** 7.5));
}

/** Liquid boiling boundary at the TOTAL ambient pressure. Partial water
 * pressure controls evaporation/saturation, but not the boiling limit.
 * Null excludes pressures below the triple point or above the critical
 * point, where the modeled liquid/vapor coexistence boundary does not exist. */
export function waterBoilingK(pressurePa: number): number | null {
  if (!(pressurePa >= WATER_TRIPLE_PA && pressurePa <= WATER_CRITICAL_PA)) return null;
  if (pressurePa === WATER_TRIPLE_PA) return WATER_TRIPLE_K;
  let low = WATER_TRIPLE_K, high = WATER_CRITICAL_K;
  for (let i = 0; i < 28; i++) {
    const mid = (low + high) * 0.5;
    if (waterSaturationPa(mid)! < pressurePa) low = mid; else high = mid;
  }
  return (low + high) * 0.5;
}
