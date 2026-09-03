import { describe, expect, it } from 'vitest';
import { refractionArcmin } from './airView';
import {
  airColumnScatter,
  airSegmentColumn,
  airmass,
  beamTransmittance,
  diffuseShadow,
  groundIrradiance,
  horizonAirmass,
  multipleScatterRadiance,
  skyRadiance,
  slantColumn,
} from './surfaceLight';

const EARTH: [number, number, number] = [0.064, 0.1, 0.18];

describe('horizonAirmass', () => {
  it('is a few dozen verticals for Earth', () => {
    const horizon = horizonAirmass(6371, 8.5);
    expect(horizon).toBeGreaterThan(30);
    expect(horizon).toBeLessThan(40);
  });
});

describe('airmass', () => {
  it('is one overhead and the horizon value at grazing', () => {
    expect(airmass(1, 35)).toBeCloseTo(1, 2);
    expect(airmass(0, 35)).toBeCloseTo(35, 6);
  });
});

describe('beamTransmittance', () => {
  it('passes most green light overhead from the ground', () => {
    const [, g] = beamTransmittance(EARTH, 0, 1, 6371, 8.5);
    expect(g).toBeGreaterThan(0.89);
    expect(g).toBeLessThan(0.92);
  });

  it('reddens the setting sun', () => {
    const [r, g, b] = beamTransmittance(EARTH, 0, 0.005, 6371, 8.5);
    expect(r).toBeGreaterThan(2.5 * g);
    expect(g).toBeGreaterThan(5 * b);
    expect(r).toBeLessThan(0.2);
  });

  it('clears above the column', () => {
    const [r, g, b] = beamTransmittance(EARTH, 400, 0.3, 6371, 8.5);
    expect(r).toBeGreaterThan(0.999);
    expect(g).toBeGreaterThan(0.999);
    expect(b).toBeGreaterThan(0.999);
  });

  it('looks down through the tangent column from orbit, and not through the ground', () => {
    // Grazing the limb from 400 km: the tangent point sits high, thin air.
    const grazing = slantColumn(400, -0.3, 6371, 8.5);
    expect(grazing).toBeGreaterThan(0);
    expect(grazing).toBeLessThan(2 * airmass(0, horizonAirmass(6371, 8.5)));
    // Straight down from 400 km meets the planet.
    expect(slantColumn(400, -0.9, 6371, 8.5)).toBe(Infinity);
  });

  it('passes everything through a vacuum', () => {
    expect(beamTransmittance([0, 0, 0], 0, 0.01, 1737, 0.1)).toEqual([1, 1, 1]);
  });
});

describe('skyRadiance', () => {
  const horizon = horizonAirmass(6371, 8.5);

  it('is a few percent of a sunlit white ground at the zenith, and blue', () => {
    const [r, g, b] = skyRadiance(EARTH, 1, 1, 1, horizon);
    expect(g).toBeGreaterThan(0.02);
    expect(g).toBeLessThan(0.08);
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  it('brightens toward the horizon', () => {
    const zenith = skyRadiance(EARTH, 1, 0.7, 0.7, horizon)[1];
    const low = skyRadiance(EARTH, 0.1, 0.7, 0.3, horizon)[1];
    expect(low).toBeGreaterThan(zenith);
  });

  it('turns red around a setting sun', () => {
    const [r, , b] = skyRadiance(EARTH, 0.05, 0.02, 0.999, horizon);
    expect(r).toBeGreaterThan(b);
  });

  it('is black in a vacuum and fades through twilight', () => {
    expect(skyRadiance([0, 0, 0], 1, 1, 1, horizon)).toEqual([0, 0, 0]);
    const dusk = skyRadiance(EARTH, 1, -0.02, 0, horizon)[1];
    const night = skyRadiance(EARTH, 1, -0.3, 0, horizon)[1];
    expect(dusk).toBeGreaterThan(0);
    expect(night).toBeLessThan(dusk * 1e-3);
  });

  it('integrates to the skylight the ground receives', () => {
    // Hemispherical irradiance from the dome against the two-stream
    // diffuse the ground model hands down, sun overhead.
    let sum = 0;
    const n = 64;
    for (let i = 0; i < n; i++) {
      const mu = (i + 0.5) / n;
      for (let j = 0; j < n; j++) {
        const phi = ((j + 0.5) / n) * 2 * Math.PI;
        const sinT = Math.sqrt(1 - mu * mu);
        const cosTheta = mu * 1 + sinT * 0 * Math.cos(phi);
        sum += skyRadiance(EARTH, mu, 1, cosTheta, horizon)[1] * mu * (1 / n) * ((2 * Math.PI) / n);
      }
    }
    const twoStream = 1 / (1 + 0.5 * EARTH[1]) - Math.exp(-EARTH[1]);
    // Both are fractions of the beam's irradiance; the dome sums to π×mean radiance.
    expect(sum / Math.PI).toBeGreaterThan(twoStream * 0.5);
    expect(sum / Math.PI).toBeLessThan(twoStream * 1.5);
  });
});

describe('multipleScatterRadiance', () => {
  const horizon = horizonAirmass(6371, 8.5);

  it('is a restrained correction for a clear terrestrial column', () => {
    const correction = multipleScatterRadiance(0.1, 0.98, 1, 1, horizon);
    expect(correction).toBeGreaterThan(0.005);
    expect(correction).toBeLessThan(0.02);
  });

  it('keeps a thick conservative atmosphere from collapsing to black', () => {
    const correction = multipleScatterRadiance(5, 0.98, 1, 1, horizon);
    expect(correction).toBeGreaterThan(0.01);
    expect(correction).toBeLessThan(0.08);
  });

  it('does not recycle strongly absorbed blue light into haze', () => {
    const warm = multipleScatterRadiance(2.1, 0.98, 1, 1, horizon);
    const blue = multipleScatterRadiance(4.65, 0.38, 1, 1, horizon);
    expect(warm).toBeGreaterThan(blue * 5);
  });
});

describe('airColumnScatter', () => {
  it('matches the sky seen from below when the eye looks straight down', () => {
    // Sun overhead, eye above the column looking at the sub-solar
    // ground: the same column, the same integral from the other end.
    const fromSpace = airColumnScatter(0, 0.1, 1, 1, 1);
    expect(fromSpace).toBeCloseTo(0.375 * 0.1 * Math.exp(-0.1) * 0.5 * (1 - Math.exp(-0.2)) / (0.1 * Math.exp(-0.1)), 3);
    expect(fromSpace).toBeGreaterThan(0.02);
  });

  it('brightens toward the limb and keeps less of the ground there', () => {
    const horizon = horizonAirmass(6371, 8.5);
    const centre = airColumnScatter(0, 0.1, 1, 1, 1);
    const limb = airColumnScatter(0, 0.1, horizon, 1, 0.1);
    expect(limb).toBeGreaterThan(centre);
  });

  it('is nothing from inside the whole column', () => {
    expect(airColumnScatter(0.1, 0.1, 1, 1, 1)).toBe(0);
  });
});

describe('airSegmentColumn', () => {
  const horizon = horizonAirmass(6371, 8.5);

  it('is the vertical column straight down from space', () => {
    expect(airSegmentColumn(0.1, 8.5, horizon, 400, 0, 400)).toBeCloseTo(0.1, 6);
  });

  it('grows with the slant and stops at the horizon column', () => {
    const slant = airSegmentColumn(0.1, 8.5, horizon, 400, 0, 800);
    expect(slant).toBeCloseTo(0.2, 6);
    expect(airSegmentColumn(0.1, 8.5, horizon, 400, 0, 1e6)).toBeCloseTo(0.1 * horizon, 6);
  });

  it('is a tenth of the vertical column across ten kilometres of sea-level air', () => {
    const level = airSegmentColumn(0.1, 8.5, horizon, 0.05, 0.05, 10);
    expect(level).toBeCloseTo((0.1 * 10) / 8.5 * Math.exp(-0.05 / 8.5), 4);
  });
});

describe('groundIrradiance', () => {
  const horizon = horizonAirmass(6371, 8.5);

  it('is most of the beam under a high sun and nothing deep in the night', () => {
    expect(groundIrradiance(0.25, 1, horizon)).toBeGreaterThan(0.85);
    expect(groundIrradiance(0.25, -0.3, horizon)).toBeLessThan(1e-6);
  });

  it('falls through twilight', () => {
    const set = groundIrradiance(0.25, 0.0, horizon);
    const dusk = groundIrradiance(0.25, -0.05, horizon);
    const late = groundIrradiance(0.25, -0.15, horizon);
    expect(set).toBeGreaterThan(dusk);
    expect(dusk).toBeGreaterThan(late);
    expect(late).toBeLessThan(set * 1e-3);
  });

  it('keeps diffuse skylight when an eclipse blocks the direct beam', () => {
    const clear = groundIrradiance(0.25, 1, horizon);
    const totality = groundIrradiance(0.25, 1, horizon, 0, 1, 0, diffuseShadow(0));
    const noSky = groundIrradiance(0.25, 1, horizon, 0, 1, 0, 0);
    expect(totality).toBeGreaterThan(0);
    expect(totality).toBeLessThan(clear);
    expect(noSky).toBe(0);
    expect(diffuseShadow(0)).toBeCloseTo(0.12, 6);
    expect(diffuseShadow(1)).toBe(1);
  });

  it('does not turn absorbed light into skylight', () => {
    const conservative = groundIrradiance(1, 1, horizon, 0.5, 1);
    const absorbing = groundIrradiance(1, 1, horizon, 0.5, 0.25);
    expect(absorbing).toBeLessThan(conservative);
  });
});

describe('refractionArcmin', () => {
  it("lifts Earth's horizon by half a degree and the zenith by nothing", () => {
    // Sæmundsson's fit at true altitude: 29′ at true zero (34′ is Bennett's at apparent zero).
    expect(refractionArcmin(0, 1)).toBeGreaterThan(27);
    expect(refractionArcmin(0, 1)).toBeLessThan(31);
    expect(refractionArcmin(45, 1)).toBeLessThan(1.2);
    expect(refractionArcmin(90, 1)).toBeLessThan(0.05);
  });

  it('flattens a disc: the lower limb lifts more than the upper', () => {
    expect(refractionArcmin(-0.25, 1) - refractionArcmin(0.25, 1)).toBeGreaterThan(3);
  });

  it('is nothing in a vacuum', () => {
    expect(refractionArcmin(0, 0)).toBe(0);
  });
});
