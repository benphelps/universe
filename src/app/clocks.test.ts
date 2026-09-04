import { describe, expect, it } from 'vitest';
import {
  describeDetent,
  DETENT_SECONDS,
  detentsFor,
  formatMultiplier,
  openingIndex,
  OPENING_SECONDS,
  REAL_RATE,
} from './clocks';

const DAY = { label: 'day', periodDays: 0.846 };
const ORBIT = { label: 'orbit', periodDays: 434 };

describe('detentsFor', () => {
  it('runs real time, then the clock from a turn an hour to a turn a second', () => {
    const detents = detentsFor(DAY);
    expect(detents[0]).toEqual({ rate: REAL_RATE, clock: null, seconds: null });
    expect(detents).toHaveLength(1 + DETENT_SECONDS.length);
    expect(detents.slice(1).every((d) => d.clock === DAY)).toBe(true);
    expect(detents.slice(1).map((d) => d.seconds)).toEqual([3600, 1800, 900, 300, 180, 120, 60, 30, 15, 5, 1]);
    expect(detents[1].rate).toBeCloseTo(0.846 / 3600, 12);
    expect(detents[11].rate).toBeCloseTo(0.846, 12);
  });

  it('is only real time where nothing turns', () => {
    expect(detentsFor(null)).toHaveLength(1);
  });
});

describe('openingIndex', () => {
  it('opens on the clock every half minute', () => {
    const detents = detentsFor(ORBIT);
    const opening = detents[openingIndex(detents)];
    expect(opening.clock).toBe(ORBIT);
    expect(opening.seconds).toBe(OPENING_SECONDS);
    expect(openingIndex(detentsFor(null))).toBe(0);
  });
});

describe('describeDetent', () => {
  it('names the clock and the pace in words', () => {
    expect(describeDetent({ rate: REAL_RATE, clock: null, seconds: null })).toBe('real time');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 3600 })).toBe('a day every hour');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 1800 })).toBe('a day every 30 minutes');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 900 })).toBe('a day every 15 minutes');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 120 })).toBe('a day every 2 minutes');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 60 })).toBe('a day every minute');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 15 })).toBe('a day every 15 seconds');
    expect(describeDetent({ rate: 1, clock: ORBIT, seconds: 1 })).toBe('an orbit every second');
    expect(describeDetent({ rate: 1, clock: { label: 'rotation', periodDays: 25 }, seconds: 300 })).toBe(
      'a rotation every 5 minutes',
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
