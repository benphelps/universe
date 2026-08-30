import { describe, expect, it } from 'vitest';
import { stellarDensity } from './density';
import { NEIGHBOR_RADIUS_PC, neighborRadiusPc } from './neighborhood';

const DISK = { xPc: 8000, yPc: 0, zPc: 0 };
const BULGE = { xPc: 200, yPc: 0, zPc: 20 };

describe('how far the neighborhood reaches', () => {
  it('holds its star count rather than its radius', () => {
    // Thirty parsecs is a count, not a distance. The bulge holds a
    // hundred and fifty times the stars per cubic parsec that the disk
    // around us does, so the same reach costs a hundred and fifty times
    // as much — and it is spent on the main thread, before the system
    // is handed over. Shrunk as the cube root of the density, what
    // stays fixed is the number of stars, which is the work.
    const crowding = stellarDensity(BULGE) / stellarDensity(DISK);
    expect(crowding).toBeGreaterThan(100);
    const ratio = neighborRadiusPc(BULGE) / neighborRadiusPc(DISK);
    // Volume goes as the cube, so the counts come out within a hair of
    // each other however crowded it is out there.
    expect(ratio ** 3 * crowding).toBeCloseTo(1, 1);
  });

  it('never reaches past where the backdrop takes over', () => {
    // Thirty parsecs is where these points hand off to the sky field's
    // own near radius. Past it the same stars would be drawn twice, so
    // however empty it is out here the reach stops there.
    for (const at of [DISK, BULGE, { xPc: 15000, yPc: 0, zPc: 900 }]) {
      expect(neighborRadiusPc(at)).toBeLessThanOrEqual(NEIGHBOR_RADIUS_PC);
    }
    // And the disk, a shade denser than the reference the radius was
    // chosen at, gives up a couple of percent and nothing more.
    expect(neighborRadiusPc(DISK) / NEIGHBOR_RADIUS_PC).toBeGreaterThan(0.95);
  });
});
