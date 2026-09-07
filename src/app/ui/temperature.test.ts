import { describe, expect, it } from 'vitest';
import { kelvinDescription, kelvinFigureTooltip, kelvinTooltip } from './temperature';

describe('Kelvin readout conversions', () => {
  it('converts absolute temperatures around freezing and absolute zero', () => {
    expect(kelvinTooltip(273.15)).toBe('0 °C · 32 °F');
    expect(kelvinTooltip(373.15)).toBe('100 °C · 212 °F');
    expect(kelvinTooltip(0)).toBe('−273.15 °C · −459.67 °F');
  });

  it('converts both endpoints of a cold range without confusing negative signs', () => {
    expect(kelvinTooltip(173.15, 263.15)).toBe('−100 to −10 °C · −148 to 14 °F');
  });

  it('does not apply absolute scale offsets to day–night differences', () => {
    expect(kelvinTooltip(20, undefined, true)).toBe('Difference: 20 °C · 36 °F');
    expect(kelvinTooltip(0, undefined, true)).toBe('Difference: 0 °C · 0 °F');
  });

  it('covers scientific notation in saved figures without interpreting other units as Kelvin', () => {
    expect(kelvinFigureTooltip('1e+5', 'K')).toBe('99730 °C · 1.795e+5 °F');
    expect(kelvinFigureTooltip('273.15', 'km')).toBeUndefined();
    expect(kelvinFigureTooltip('—', 'K')).toBeUndefined();
    expect(kelvinFigureTooltip('', 'K')).toBeUndefined();
    expect(kelvinTooltip(Infinity)).toBeUndefined();
    expect(kelvinTooltip(-1)).toBeUndefined();
    expect(kelvinTooltip(100, NaN)).toBeUndefined();
  });

  it('includes equivalent scales for temperatures embedded in explanatory tooltips', () => {
    expect(kelvinDescription(273.15, 373.15)).toBe('273–373 K (0 to 100 °C · 32 to 212 °F)');
  });

  it('uses the same unrounded temperature in headline and detailed readouts', () => {
    expect(kelvinFigureTooltip('273', 'K', 273.15)).toBe(kelvinTooltip(273.15));
  });
});
