/** Compact scientific-friendly number formatting for UI readouts. */
export function fmt(value: number, digits = 3): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(digits - 1);
  return Number(value.toPrecision(digits)).toString();
}

export function fmtYears(years: number): string {
  if (years >= 1e9) return `${fmt(years / 1e9)} Gyr`;
  if (years >= 1e6) return `${fmt(years / 1e6)} Myr`;
  return `${fmt(years)} yr`;
}

export function fmtDays(days: number): string {
  if (days >= 365.25) return fmtYears(days / 365.25);
  if (days >= 1) return `${fmt(days)} d`;
  if (days >= 1 / 24) return `${fmt(days * 24)} h`;
  return `${fmt(days * 86400)} s`;
}

/** Solar masses in the units the eye reads fastest: a hole of half a
 *  million suns is "493k", not "4.93e+5". Shared so the same body
 *  cannot read one way in the galaxy list and another in the marks. */
export function fmtSolarMasses(value: number): string {
  if (value >= 1e8) return `${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return value.toFixed(0);
}
