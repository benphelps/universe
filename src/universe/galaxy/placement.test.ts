import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng/rng';
import { starsNear } from './catalog';
import { cloudFieldAt } from './clouds';

/** The Musas complex's own neighbourhood: gas in every direction. */
const CLOUDY = { xPc: 8816.1, yPc: 90.9, zPc: 57.8 };

describe('field stars and the clouds', () => {
  it('pass through the gas at its filling factor, no more and no less', () => {
    // Stars older than the thirty million years the catalog starts at
    // have long since left the cloud they were born in, and a cloud's
    // gravity is nothing to a passing star, so the field is
    // uncorrelated with the gas: the share of catalog stars standing
    // in cloud gas is the share of the volume the gas fills. Only the
    // natal groups are embedded, and the nebula model draws those.
    const radius = 30;
    const stars = starsNear(CLOUDY, radius);
    let inGas = 0;
    for (const star of stars) if (cloudFieldAt(star.positionPc) > 0) inGas++;
    const rng = new Rng(11n);
    const samples = 30000;
    let volume = 0;
    let inside = 0;
    for (let i = 0; i < samples; i++) {
      const x = (rng.float() * 2 - 1) * radius;
      const y = (rng.float() * 2 - 1) * radius;
      const z = (rng.float() * 2 - 1) * radius;
      if (x * x + y * y + z * z > radius * radius) continue;
      inside++;
      if (cloudFieldAt({ xPc: CLOUDY.xPc + x, yPc: CLOUDY.yPc + y, zPc: CLOUDY.zPc + z }) > 0) volume++;
    }
    const starShare = inGas / stars.length;
    const volumeShare = volume / inside;
    expect(stars.length).toBeGreaterThan(2000);
    expect(volumeShare).toBeGreaterThan(0.02);
    expect(starShare / volumeShare).toBeGreaterThan(0.6);
    expect(starShare / volumeShare).toBeLessThan(1.6);
  });
});
