import { fmt } from './format';

function degrees(value: number): string {
  // Keep the scale offsets visible near familiar temperatures; avoid false precision for stars.
  return (Math.abs(value) >= 1e4 ? fmt(value, 4) : String(Number(value.toFixed(2)))).replace('-', '−');
}

/** Absolute temperatures include the scale offsets; temperature differences do not. */
export function kelvinTooltip(kelvin: number, maximumK?: number, difference = false): string | undefined {
  if (![kelvin, maximumK ?? kelvin].every(value => Number.isFinite(value) && (difference || value >= 0))) return undefined;
  const celsius = (value: number) => difference ? value : value - 273.15;
  const fahrenheit = (value: number) => celsius(value) * 9 / 5 + (difference ? 0 : 32);
  const range = (convert: (value: number) => number) => maximumK === undefined
    ? degrees(convert(kelvin)) : `${degrees(convert(kelvin))} to ${degrees(convert(maximumK))}`;
  return `${difference ? 'Difference: ' : ''}${range(celsius)} °C · ${range(fahrenheit)} °F`;
}

/** Shared figures also cover saved catalog rows, which retain formatted strings. */
export function kelvinFigureTooltip(value: string, unit?: string, kelvin?: number): string | undefined {
  return unit === 'K' && value.trim() !== '' ? kelvinTooltip(kelvin ?? Number(value)) : undefined;
}

/** For temperatures already inside an explanatory tooltip. */
export function kelvinDescription(kelvin: number, maximumK?: number): string {
  return `${fmt(kelvin)}${maximumK === undefined ? '' : `–${fmt(maximumK)}`} K (${kelvinTooltip(kelvin, maximumK) ?? 'conversion unavailable'})`;
}
