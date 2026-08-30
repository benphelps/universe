import { afterEach, describe, expect, it } from 'vitest';
import { stellarDensity } from './density';
import {
  NEIGHBOR_RADIUS_PC,
  neighborBudget,
  neighborRadiusPc,
  setNeighborBudget,
} from './neighborhood';

const DISK = { xPc: 8000, yPc: 0, zPc: 0 };
const BULGE = { xPc: 200, yPc: 0, zPc: 20 };

afterEach(() => setNeighborBudget(1));

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

  it('leaves the disk alone', () => {
    // Where the shrink does not bite there is nothing to fix: the
    // radius is the shipped one, and no budget buys past it, because
    // that is where these points hand off to the backdrop and past it
    // they would be drawn twice.
    // The disk is a shade denser than the reference, so it gives up a
    // couple of percent of its reach and nothing more.
    expect(neighborRadiusPc(DISK) / NEIGHBOR_RADIUS_PC).toBeGreaterThan(0.95);
    setNeighborBudget(16);
    expect(neighborRadiusPc(DISK)).toBe(NEIGHBOR_RADIUS_PC);
  });

  it('spends the budget where the shrink bites', () => {
    const shipped = neighborRadiusPc(BULGE);
    setNeighborBudget(8);
    // A cube root inside a cube is a straight multiple, so the dial
    // reads as the star count it buys.
    expect((neighborRadiusPc(BULGE) / shipped) ** 3).toBeCloseTo(8, 5);
  });

  it('will not be set past what it can survive', () => {
    setNeighborBudget(1e6);
    expect(neighborBudget()).toBeLessThanOrEqual(64);
    setNeighborBudget(0);
    expect(neighborBudget()).toBeGreaterThan(0);
  });
});
