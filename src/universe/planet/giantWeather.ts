const TAU = 2 * Math.PI;
export const WEATHER_REGEN_DAYS = 32;

export function wrapWeatherAngle(angle: number): number {
  return ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

/** Positive zonal wind follows positive body rotation: atan(z,x) decreases. */
export function advectedStormLongitude(initial: number, driftRadPerDay: number, days: number): number {
  return wrapWeatherAngle(initial - wrapWeatherAngle(driftRadPerDay * days));
}

function phaseSeed(cycle: number, salt: number): [number, number, number] {
  const hash = (offset: number) => {
    let h = (cycle | 0) ^ salt ^ offset;
    h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
    h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
    return ((h ^ (h >>> 15)) >>> 0) / 0xffffffff * 64;
  };
  return [hash(713), hash(1979), hash(3083)];
}

/** Limit differential displacement across a jet to two radians per radian
 * of latitude. A fixed multi-week lifetime winds fast jets into thin threads.
 * smoothstep's maximum derivative is 1.5; each edge blends half the jump. */
export function giantWeatherLifetime(bands: readonly { driftRadPerDay: number }[]): number {
  let shear = 0;
  for (let i = 1; i < bands.length; i++) {
    shear = Math.max(shear, 0.75 * Math.abs(bands[i].driftRadPerDay - bands[i - 1].driftRadPerDay) / 0.04);
  }
  // A parcel's maximum age is half its renewal period.
  return Math.min(WEATHER_REGEN_DAYS, 4 / Math.max(shear, 1e-6));
}

/** Two renewing parcels. Each seed changes only while its weight is zero;
 * absolute cycle identity never travels to a float32 shader clock. */
export function giantWeatherPhases(timeDays: number, lifetimeDays = WEATHER_REGEN_DAYS) {
  const cycle = Math.floor(timeDays / lifetimeDays);
  const phase = (timeDays - cycle * lifetimeDays) / lifetimeDays;
  const weightA = 1 - Math.abs(2 * phase - 1);
  const cycleB = cycle + (phase >= .5 ? 1 : 0);
  return {
    ageA: (phase - .5) * lifetimeDays,
    ageB: (phase < .5 ? phase : phase - 1) * lifetimeDays,
    weightA, weightB: 1 - weightA,
    seedA: phaseSeed(cycle, 317), seedB: phaseSeed(cycleB, 813),
  };
}

/** Smooth bounded decorrelation, with incommensurate periods. No clock fold,
 * ever-growing noise coordinates, or simultaneous reset of all components. */
export function giantChurnOffset(timeDays: number, rate: number): [number, number, number] {
  return [1, Math.SQRT2, Math.sqrt(3)].map((f, i) =>
    12 * Math.sin(wrapWeatherAngle(timeDays * rate * f / 12 + i * 2.1))) as [number, number, number];
}
