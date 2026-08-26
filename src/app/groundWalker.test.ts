import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT_M, GroundWalker, type WalkSurface } from './groundWalker';

const R_KM = 6371;
const DT = 1 / 60;

function surface(overrides: Partial<WalkSurface> = {}): WalkSurface {
  return {
    radiusKm: R_KM,
    gravityMs2: 9.8,
    heightM: () => 0,
    waterLevelM: () => -Infinity,
    ...overrides,
  };
}

/** Start on the equator: the tangent basis is unambiguous there. */
function standing(walker: GroundWalker, ground: WalkSurface): Vector3 {
  const position = new Vector3(R_KM + 0.05, 0, 0);
  walker.beginLanding(ground);
  for (let i = 0; i < 600 && walker.phase !== 'walking'; i++) {
    walker.update(DT, position, 0);
  }
  return position;
}

function altitudeM(position: Vector3, ground: WalkSurface, up = position.clone().normalize()) {
  return position.length() * 1000 - (ground.radiusKm * 1000 + ground.heightM(up));
}

describe('ground walker', () => {
  it('lands the glide at eye height', () => {
    const walker = new GroundWalker();
    const ground = surface();
    const position = standing(walker, ground);
    expect(walker.phase).toBe('walking');
    expect(altitudeM(position, ground)).toBeCloseTo(EYE_HEIGHT_M, 4);
  });

  it('walks at walking pace and stays on the ground', () => {
    const walker = new GroundWalker();
    const ground = surface();
    const position = standing(walker, ground);
    const start = position.clone();
    walker.press('KeyW');
    for (let i = 0; i < 60; i++) walker.update(DT, position, 0);
    const movedM = position.distanceTo(start) * 1000;
    expect(movedM).toBeGreaterThan(1.5);
    expect(movedM).toBeLessThan(2.0);
    expect(altitudeM(position, ground)).toBeCloseTo(EYE_HEIGHT_M, 4);
  });

  it('jump height follows the body gravity', () => {
    const peak = (gravityMs2: number): number => {
      const walker = new GroundWalker();
      const ground = surface({ gravityMs2 });
      const position = standing(walker, ground);
      walker.press('Space');
      let highest = 0;
      for (let i = 0; i < 3000; i++) {
        walker.update(DT, position, 0);
        highest = Math.max(highest, altitudeM(position, ground) - EYE_HEIGHT_M);
        if (i > 2 && altitudeM(position, ground) <= EYE_HEIGHT_M + 1e-6) break;
      }
      return highest;
    };
    const earth = peak(9.8);
    const moon = peak(1.62);
    expect(earth).toBeCloseTo(3.1 ** 2 / (2 * 9.8), 1);
    expect(moon / earth).toBeCloseTo(9.8 / 1.62, 0);
  });

  it('refuses grades steeper than a climbable slope', () => {
    const climb = (grade: number): number => {
      const walker = new GroundWalker();
      // Ground rises northward (+y) at the given grade.
      const ground = surface({ heightM: (up) => Math.max(0, up.y) * R_KM * 1000 * grade });
      const position = standing(walker, ground);
      const start = position.clone();
      walker.press('KeyW');
      for (let i = 0; i < 120; i++) walker.update(DT, position, 0);
      return position.distanceTo(start) * 1000;
    };
    expect(climb(2.0)).toBeLessThan(0.01);
    const gentle = climb(0.3);
    expect(gentle).toBeGreaterThan(1);
    expect(gentle).toBeLessThan(climb(0));
  });

  it('stops at chest-deep water', () => {
    const walker = new GroundWalker();
    const ground = surface({ heightM: () => -3, waterLevelM: () => 0 });
    const position = standing(walker, ground);
    const start = position.clone();
    walker.press('KeyW');
    for (let i = 0; i < 60; i++) walker.update(DT, position, 0);
    expect(position.distanceTo(start)).toBeLessThan(1e-8);
  });

  it('falls off an edge and lands below', () => {
    const walker = new GroundWalker();
    const cliffM = 30;
    const ground = surface({
      heightM: (up) => (up.y * R_KM * 1000 > 1 ? -cliffM : 0),
    });
    const position = standing(walker, ground);
    walker.press('KeyW');
    let wasAirborne = false;
    for (let i = 0; i < 1200; i++) {
      walker.update(DT, position, 0);
      if (altitudeM(position, ground) > EYE_HEIGHT_M + 1) wasAirborne = true;
    }
    expect(wasAirborne).toBe(true);
    expect(altitudeM(position, ground)).toBeCloseTo(EYE_HEIGHT_M, 3);
    expect(position.length()).toBeLessThan(R_KM + (EYE_HEIGHT_M - cliffM + 1) / 1000);
  });
});
