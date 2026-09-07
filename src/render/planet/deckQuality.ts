/** Cubemap detail follows projected pixels, with hysteresis on retreat.
 * Fast weather sacrifices fine texture detail before it consumes the
 * frame budget. Spin, lighting and eclipses continue at full frame rate. */
export function deckSizeForView(diameterPixels: number, maximum: number, current: number,
  fastWeather: boolean): number {
  const cap = Math.min(maximum, fastWeather ? 256 : maximum);
  let wanted = 16;
  while (wanted < Math.min(cap, Math.max(16, diameterPixels * 0.7))) wanted *= 2;
  wanted = Math.min(cap, wanted);
  return current > wanted && current <= cap && diameterPixels * 0.7 > current * 0.3 ? current : wanted;
}

/** Rate is simulation days per real second, independent of frame rate.
 * The previous four-frame window could rebake a giant 15 times/second. */
export function deckWindowDays(baseDays: number, daysPerSecond: number, stagger: number): number {
  return Math.max(baseDays, Math.abs(daysPerSecond) * 0.35) * stagger;
}
