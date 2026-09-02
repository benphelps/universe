import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng/rng';
import { clustersNear } from './clusters';
import { armBoost, dustDensity, HOME_POSITION } from './density';

describe('the open clusters', () => {
  it('stand at one place from every viewpoint', () => {
    // A cluster is an object of the galaxy, not of the sky that sees
    // it: two overlapping queries name the same clusters by seed at
    // the same positions.
    const here = clustersNear(HOME_POSITION, 600);
    const there = clustersNear({ xPc: 8300, yPc: 200, zPc: -40 }, 600);
    const byseed = new Map(here.map((cluster) => [cluster.seed, cluster]));
    let shared = 0;
    for (const cluster of there) {
      const twin = byseed.get(cluster.seed);
      if (!twin) continue;
      shared++;
      expect(twin.positionPc).toEqual(cluster.positionPc);
      expect(twin.ageGyr).toBe(cluster.ageGyr);
    }
    expect(shared).toBeGreaterThan(20);
  });

  it('number what the young disk holds', () => {
    // 1.8 per 10⁷ pc³ at the solar circle, following the dust disk
    // concentrated onto the arms: the count in a kiloparsec ball
    // against that tracer integrated over the same ball.
    const radius = 1000;
    const found = clustersNear(HOME_POSITION, radius).length;
    const tracer = (x: number, y: number, z: number): number =>
      dustDensity({ xPc: x, yPc: y, zPc: z }) * (0.4 + 0.6 * armBoost(Math.hypot(x, y), Math.atan2(y, x)));
    const home = tracer(HOME_POSITION.xPc, HOME_POSITION.yPc, HOME_POSITION.zPc);
    const rng = new Rng(7n);
    const samples = 20000;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      const x = (rng.float() * 2 - 1) * radius;
      const y = (rng.float() * 2 - 1) * radius;
      const z = (rng.float() * 2 - 1) * radius;
      if (x * x + y * y + z * z > radius * radius) continue;
      sum += tracer(HOME_POSITION.xPc + x, HOME_POSITION.yPc + y, HOME_POSITION.zPc + z) / home;
    }
    const expected = 1.8e-7 * (2 * radius) ** 3 * (sum / samples);
    expect(found / expected).toBeGreaterThan(0.7);
    expect(found / expected).toBeLessThan(1.4);
    // Ages run from the clouds' dispersal to the survivors.
    for (const cluster of clustersNear(HOME_POSITION, radius)) {
      expect(cluster.ageGyr).toBeGreaterThanOrEqual(0.012);
      expect(cluster.ageGyr).toBeLessThanOrEqual(2.5);
    }
  });
});
