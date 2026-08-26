import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CLEARANCE_M, FlightCamera, type FlightSurface } from './flightCamera';

const RADIUS_KM = 6371;

function flatSurface(groundM = 0, waterM = -Infinity): FlightSurface {
  return {
    radiusKm: RADIUS_KM,
    heightM: () => groundM,
    waterLevelM: () => waterM,
  };
}

function airborne(surface: FlightSurface, aglM: number): [FlightCamera, Vector3] {
  const flight = new FlightCamera();
  flight.begin(surface);
  const position = new Vector3(0, RADIUS_KM + (surface.heightM(new Vector3()) + aglM) / 1000, 0);
  return [flight, position];
}

/** Run frames at a fixed step; heading 0 = local north (+x at the pole). */
function fly(
  flight: FlightCamera,
  position: Vector3,
  seconds: number,
  heading = 0,
  pitch = 0,
): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) flight.update(step, position, heading, pitch);
}

describe('FlightCamera', () => {
  it('flies where the camera looks, pitch included', () => {
    const [flight, position] = airborne(flatSurface(), 100);
    const start = position.clone();
    flight.press('KeyW');
    fly(flight, position, 4, 0, 0.5);
    const up = start.clone().normalize();
    const climbM = (position.length() - start.length()) * 1000;
    const tangentM = position.clone().sub(start).addScaledVector(up, -climbM / 1000).length() * 1000;
    expect(climbM).toBeGreaterThan(20);
    expect(tangentM).toBeGreaterThan(climbM * 0.9);
  });

  it('never clips into the terrain, and slides along the floor', () => {
    const surface = flatSurface(500);
    const [flight, position] = airborne(surface, 30);
    flight.press('KeyW');
    fly(flight, position, 10, 0, -1.2);
    const aglM = position.length() * 1000 - (RADIUS_KM * 1000 + 500);
    expect(aglM).toBeGreaterThanOrEqual(CLEARANCE_M * 0.99);
    expect(aglM).toBeLessThan(CLEARANCE_M * 3);
  });

  it('holds clearance over open water', () => {
    const surface = flatSurface(-2000, 0);
    const [flight, position] = airborne(surface, 50);
    flight.press('KeyC');
    fly(flight, position, 10);
    const aglM = position.length() * 1000 - RADIUS_KM * 1000;
    expect(aglM).toBeGreaterThanOrEqual(CLEARANCE_M * 0.99);
  });

  it('speed scales with height above ground', () => {
    const low = airborne(flatSurface(), 10);
    const high = airborne(flatSurface(), 1000);
    for (const [flight, position] of [low, high]) {
      flight.press('KeyW');
      fly(flight, position, 3);
    }
    const traveled = (pair: [FlightCamera, Vector3], aglM: number) =>
      pair[1].distanceTo(new Vector3(0, RADIUS_KM + aglM / 1000, 0)) * 1000;
    const lowM = traveled(low, 10);
    const highM = traveled(high, 1000);
    expect(highM).toBeGreaterThan(lowM * 20);
  });

  it('boost multiplies the pace', () => {
    const slow = airborne(flatSurface(), 100);
    const fast = airborne(flatSurface(), 100);
    fast[0].press('ShiftLeft');
    for (const [flight, position] of [slow, fast]) {
      flight.press('KeyW');
      fly(flight, position, 3);
    }
    const origin = new Vector3(0, RADIUS_KM + 0.1, 0);
    expect(fast[1].distanceTo(origin)).toBeGreaterThan(slow[1].distanceTo(origin) * 3);
  });

  it('rises on Space and stops rising when released', () => {
    const [flight, position] = airborne(flatSurface(), 20);
    flight.press('Space');
    fly(flight, position, 3);
    const risenM = position.length() * 1000 - (RADIUS_KM * 1000 + 20);
    expect(risenM).toBeGreaterThan(10);
    flight.release('Space');
    const before = position.length();
    fly(flight, position, 2);
    // Inertia bleeds off: barely coasts once the key is up.
    expect(position.length() - before).toBeLessThan(risenM / 1000 / 4);
  });

  it('stop() ends the regime and clears state', () => {
    const [flight, position] = airborne(flatSurface(), 20);
    flight.press('KeyW');
    fly(flight, position, 1);
    flight.stop();
    expect(flight.active).toBe(false);
    const frozen = position.clone();
    flight.update(1 / 60, position, 0, 0);
    expect(position.equals(frozen)).toBe(true);
  });
});
