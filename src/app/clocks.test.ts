import { describe, expect, it } from 'vitest';
import {
  describeDetent,
  detentsFor,
  formatMultiplier,
  openingIndex,
  OPENING_SECONDS,
  REAL_RATE,
  REAL_TIME,
} from './clocks';

const DAY = { label: 'day', periodDays: 0.846 };
const YEAR = { label: 'year', periodDays: 434 };
const WORLD = [REAL_TIME, DAY, YEAR];

describe('detentsFor', () => {
  it('runs from real time up through every clock, ascending, without doubles', () => {
    const detents = detentsFor(WORLD);
    expect(detents[0]).toEqual({ rate: REAL_RATE, clock: null, seconds: null });
    for (let i = 1; i < detents.length; i++) {
      expect(detents[i].rate / detents[i - 1].rate).toBeGreaterThanOrEqual(1.25);
    }
    expect(detents[detents.length - 1]).toEqual({ rate: 434, clock: YEAR, seconds: 1 });
    // A day a second and a year an hour are near enough to be one stop.
    expect(detents.filter((d) => Math.abs(Math.log10(d.rate / 0.846)) < 0.1)).toHaveLength(1);
  });

  it('keeps every clock\'s half-minute stop, the labelled one', () => {
    const detents = detentsFor(WORLD);
    const labelled = detents.filter((d) => d.seconds === OPENING_SECONDS).map((d) => d.clock?.label);
    expect(labelled).toEqual(['day', 'year']);
  });

  it('is only real time where nothing turns', () => {
    expect(detentsFor([REAL_TIME])).toHaveLength(1);
  });
});

describe('openingIndex', () => {
  it('opens on the quickest clock every half minute', () => {
    const detents = detentsFor(WORLD);
    const opening = detents[openingIndex(detents)];
    expect(opening.clock).toBe(DAY);
    expect(opening.seconds).toBe(OPENING_SECONDS);
    expect(openingIndex(detentsFor([REAL_TIME]))).toBe(0);
  });
});

describe('describeDetent', () => {
  it('names the clock and the pace', () => {
    expect(describeDetent({ rate: REAL_RATE, clock: null, seconds: null })).toBe('real time');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 15 })).toBe('a day every 15 s');
    expect(describeDetent({ rate: 1, clock: YEAR, seconds: 300 })).toBe('a year every 5 min');
    expect(describeDetent({ rate: 1, clock: { label: 'inner orbit', periodDays: 1 }, seconds: 3600 })).toBe(
      'an inner orbit every 1 h',
    );
  });
});

describe('formatMultiplier', () => {
  it('keeps to a few characters at every decade', () => {
    expect(formatMultiplier(REAL_RATE)).toBe('×1');
    expect(formatMultiplier(0.001)).toBe('×86');
    expect(formatMultiplier(0.05)).toBe('×4.3k');
    expect(formatMultiplier(5)).toBe('×432k');
    expect(formatMultiplier(500)).toBe('×43M');
    expect(formatMultiplier(21000)).toBe('×1.8G');
  });
});
