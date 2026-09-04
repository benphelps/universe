import { describe, expect, it } from 'vitest';
import {
  describeRate,
  formatMultiplier,
  MAX_RATE,
  openingRate,
  rateAtPosition,
  ratePosition,
  REAL_RATE,
  REAL_TIME,
} from './clocks';

const WORLD = [REAL_TIME, { label: 'day', periodDays: 0.846 }, { label: 'year', periodDays: 434 }];

describe('the rate axis', () => {
  it('runs from real time to the top and back', () => {
    expect(ratePosition(REAL_RATE)).toBe(0);
    expect(ratePosition(MAX_RATE)).toBe(1);
    expect(rateAtPosition(0.5)).toBeCloseTo(REAL_RATE * 1e4, 12);
    expect(ratePosition(rateAtPosition(0.37))).toBeCloseTo(0.37, 9);
  });

  it('opens a focus on its quickest clock turning in half a minute', () => {
    expect(openingRate(WORLD)).toBeCloseTo(0.846 / 30, 9);
    expect(openingRate([REAL_TIME])).toBe(REAL_RATE);
  });
});

describe('formatMultiplier', () => {
  it('keeps to three or four characters at every decade', () => {
    expect(formatMultiplier(REAL_RATE)).toBe('×1');
    expect(formatMultiplier(0.001)).toBe('×86');
    expect(formatMultiplier(0.05)).toBe('×4.3k');
    expect(formatMultiplier(5)).toBe('×432k');
    expect(formatMultiplier(500)).toBe('×43M');
  });
});

describe('describeRate', () => {
  it('names the largest clock that still turns inside ten minutes', () => {
    expect(describeRate(REAL_RATE, WORLD)).toBe('real time');
    expect(describeRate(0.001, WORLD)).toBe('a day every 14 min');
    expect(describeRate(0.0846, WORLD)).toBe('a day every 10 s');
    expect(describeRate(5, WORLD)).toBe('a year every 1 min');
    expect(describeRate(100, WORLD)).toBe('a year every 4.3 s');
  });

  it('says so where nothing turns', () => {
    expect(describeRate(1, [REAL_TIME])).toBe('nothing here turns');
  });
});
