import { describe, expect, it } from 'vitest';
import { deckSizeForView, deckWindowDays } from './deckQuality';

describe('projected giant weather budget', () => {
  it('keeps a small parent in a moon sky cheap and restores close-up detail', () => {
    expect(deckSizeForView(70, 1024, 0, false)).toBe(64);
    expect(deckSizeForView(2000, 1024, 64, false)).toBe(1024);
    expect(deckSizeForView(2000, 1024, 1024, true)).toBe(256);
    expect(deckSizeForView(2000, 1024, 256, false)).toBe(1024);
    expect(deckSizeForView(0, 1024, 0, false)).toBe(16);
  });
  it('does not oscillate texture allocation near a detail boundary', () => {
    const upgraded = deckSizeForView(100, 1024, 64, false);
    expect(upgraded).toBe(128);
    expect(deckSizeForView(90, 1024, upgraded, false)).toBe(upgraded);
    expect(deckSizeForView(40, 1024, upgraded, false)).toBe(32);
  });
  it('uses a real-time cadence independently of frame count and time direction', () => {
    expect(deckWindowDays(0.02, 0, 1)).toBe(0.02);
    expect(deckWindowDays(0.02, 1 / 86400, 1)).toBe(0.02);
    for (const rate of [0.8, 10, -10, 1000]) {
      expect(deckWindowDays(0.02, rate, 1) / Math.abs(rate)).toBeCloseTo(0.35);
    }
  });
});
