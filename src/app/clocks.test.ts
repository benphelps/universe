import { describe, expect, it } from 'vitest';
import {
  beginsRun,
  describeDetent,
  DETENT_SECONDS,
  detentsFor,
  formatMultiplier,
  openingIndex,
  OPENING_SECONDS,
  orderNote,
  REAL_RATE,
  REAL_TIME,
} from './clocks';

const DAY = { label: 'day', periodDays: 0.846 };
const MONTH = { label: 'month', periodDays: 27.3 };
const YEAR = { label: 'year', periodDays: 434 };
const WORLD = [REAL_TIME, DAY, MONTH, YEAR];
/** A close moon: its month is shorter than the day. */
const QUICK_MONTH = { label: 'month', periodDays: 0.32 };
const SLOW_WORLD = { owner: 'd', subject: 'this world', clocks: [REAL_TIME, DAY, QUICK_MONTH, YEAR] };

describe('detentsFor', () => {
  it('runs real time, then each clock whole, shortest clock first', () => {
    const detents = detentsFor(WORLD);
    expect(detents[0]).toEqual({ rate: REAL_RATE, clock: null, seconds: null });
    expect(detents).toHaveLength(1 + 3 * DETENT_SECONDS.length);
    const clocks = detents.slice(1).map((d) => d.clock?.label);
    expect(clocks).toEqual([
      ...Array(8).fill('day'),
      ...Array(8).fill('month'),
      ...Array(8).fill('year'),
    ]);
    const paces = detents.slice(1, 9).map((d) => d.seconds);
    expect(paces).toEqual([3600, 1800, 300, 60, 30, 15, 5, 1]);
    expect(detents[8].rate).toBeCloseTo(0.846, 9);
    expect(detents[9].rate).toBeCloseTo(27.3 / 3600, 9);
  });

  it('puts a quick month before a long day, and says so', () => {
    const clocks = detentsFor(SLOW_WORLD.clocks).slice(1).map((d) => d.clock?.label);
    expect(clocks.slice(0, 8)).toEqual(Array(8).fill('month'));
    expect(clocks.slice(8, 16)).toEqual(Array(8).fill('day'));
    expect(orderNote(SLOW_WORLD)).toBe("this world's day is longer than its month");
    expect(orderNote({ owner: 'i', subject: 'this world', clocks: WORLD })).toBeNull();
  });

  it('names a clock where its run begins', () => {
    const detents = detentsFor(WORLD);
    expect(detents.filter(beginsRun).map((d) => d.clock?.label)).toEqual(['day', 'month', 'year']);
  });

  it('is only real time where nothing turns', () => {
    expect(detentsFor([REAL_TIME])).toHaveLength(1);
  });
});

describe('openingIndex', () => {
  it('opens on the shortest clock every half minute', () => {
    const detents = detentsFor(SLOW_WORLD.clocks);
    const opening = detents[openingIndex(detents)];
    expect(opening.clock).toBe(QUICK_MONTH);
    expect(opening.seconds).toBe(OPENING_SECONDS);
    expect(openingIndex(detentsFor([REAL_TIME]))).toBe(0);
  });
});

describe('describeDetent', () => {
  it('names the clock and the pace in words', () => {
    expect(describeDetent({ rate: REAL_RATE, clock: null, seconds: null })).toBe('real time');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 3600 })).toBe('a day every hour');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 1800 })).toBe('a day every 30 minutes');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 60 })).toBe('a day every minute');
    expect(describeDetent({ rate: 1, clock: DAY, seconds: 15 })).toBe('a day every 15 seconds');
    expect(describeDetent({ rate: 1, clock: YEAR, seconds: 1 })).toBe('a year every second');
    expect(describeDetent({ rate: 1, clock: { label: 'inner orbit', periodDays: 1 }, seconds: 300 })).toBe(
      'an inner orbit every 5 minutes',
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
