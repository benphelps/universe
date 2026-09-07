import { expect, it } from 'vitest';
import { Rng } from '../../core/rng/rng';
import { generateComets } from './comets';

const reservoirs = { scatteredDiscInnerAu: 40, oortInnerAu: 2000, oortOuterAu: 50000 };

it('samples observation time uniformly, including the first candidate', () => {
  let cosine = 0, sine = 0;
  const bins = new Array<number>(8).fill(0), count = 2048;
  for (let seed = 0; seed < count; seed++) {
    const comet = generateComets(new Rng(BigInt(seed)), 'test', reservoirs)[0];
    const phase = comet.elements.meanAnomalyAtEpoch;
    expect(phase).toBeGreaterThanOrEqual(0); expect(phase).toBeLessThan(2 * Math.PI);
    cosine += Math.cos(phase); sine += Math.sin(phase);
    bins[Math.floor(phase / (2 * Math.PI) * bins.length)]++;
  }
  expect(Math.hypot(cosine, sine) / count).toBeLessThan(0.05);
  for (const bin of bins) expect(Math.abs(bin - count / 8)).toBeLessThan(5 * Math.sqrt(count / 8));
});

it('uses equal host flux for activity without moving the underlying orbits', () => {
  const make = (luminosity: number) => generateComets(new Rng(45n), 'test', reservoirs, 3, luminosity);
  const solar = make(1);
  expect(make(1)).toEqual(solar);
  for (const luminosity of [0, 0.01, 100]) {
    const comets = make(luminosity);
    for (let i = 0; i < comets.length; i++) {
      expect(comets[i].elements).toEqual(solar[i].elements);
      expect(comets[i].activityOnsetAu).toBeCloseTo(solar[i].activityOnsetAu * Math.sqrt(luminosity), 12);
    }
  }
});
