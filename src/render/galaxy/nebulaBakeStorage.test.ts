import { describe, expect, it } from 'vitest';
import { NebulaBakeStorage, nebulaStorageLayout } from './nebulaBakeStorage';

describe('nebula GPU working storage', () => {
  it('bounds grade transitions and frees the old allocation before making a new one', () => {
    let liveBytes = 0, peakBytes = 0;
    const cache = new NebulaBakeStorage(80 << 20, size => {
      liveBytes += nebulaStorageLayout(size).bytes;
      peakBytes = Math.max(peakBytes, liveBytes); return { size };
    }, value => { liveBytes -= nebulaStorageLayout(value.size).bytes; });
    for (const size of [48, 96, 160, 48, 96, 160, 48]) {
      const entry = cache.acquire(size);
      expect(cache.acquire(size)).toBe(entry);
      expect(cache.bytes).toBe(liveBytes);
    }
    expect(peakBytes).toBeLessThanOrEqual(cache.budgetBytes);
    cache.dispose(); cache.dispose();
    expect(liveBytes).toBe(0); expect(cache.bytes).toBe(0);
  });

  it('does not retain failed or over-budget allocations', () => {
    const cache = new NebulaBakeStorage(80 << 20, (size): number => {
      if (size === 160) throw new Error('allocation failed'); return size;
    }, () => {});
    cache.acquire(96);
    expect(() => cache.acquire(256)).toThrow('staging budget');
    expect(cache.bytes).toBe(nebulaStorageLayout(96).bytes);
    expect(() => cache.acquire(160)).toThrow('allocation failed');
    expect(cache.bytes).toBe(0);
  });
});
