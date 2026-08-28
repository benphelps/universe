import { describe, expect, it } from 'vitest';
import { generateStar } from '../../universe/star/generate';
import { stellarSurfaceModel, stellarSurfaceStateAt } from './surfaceModel';

describe('stellarSurfaceModel', () => {
  it('scales convection from fine dwarfs to long-lived giant cells', () => {
    const sun = generateStar(1n, {
      massInitial: 1,
      ageGyr: 4.6,
      feH: 0,
      withCompanions: false,
    });
    const giant = generateStar(3n, {
      massInitial: 18,
      ageGyr: 0.00595,
      feH: 0,
      withCompanions: false,
    });
    const solarModel = stellarSurfaceModel(sun);
    const giantModel = stellarSurfaceModel(giant);
    expect(giantModel.granuleFrequency).toBeLessThan(solarModel.granuleFrequency);
    expect(giantModel.granuleLifetimeDays).toBeGreaterThan(solarModel.granuleLifetimeDays);
  });

  it('keeps all uploaded phases bounded even after millions of rotations', () => {
    const star = generateStar(2n, {
      massInitial: 0.2,
      ageGyr: 1,
      withCompanions: false,
    });
    const model = stellarSurfaceModel(star);
    const state = stellarSurfaceStateAt(star, model, star.activity.rotationPeriodDays * 1e7);
    expect(state.rotationPhase).toBeGreaterThanOrEqual(0);
    expect(state.rotationPhase).toBeLessThan(2 * Math.PI);
    expect(state.spotRotationPhase).toBeGreaterThanOrEqual(0);
    expect(state.spotRotationPhase).toBeLessThan(2 * Math.PI);
    expect(state.spotPhase).toBeGreaterThanOrEqual(0);
    expect(state.spotPhase).toBeLessThan(1);
    expect(state.granulePhase).toBeGreaterThanOrEqual(0);
    expect(state.granulePhase).toBeLessThan(1);
  });

  it('hands the current active-region generation to the previous slot continuously', () => {
    const star = generateStar(1n, {
      massInitial: 1,
      ageGyr: 4.6,
      withCompanions: false,
    });
    const model = stellarSurfaceModel(star);
    const boundary = model.spotLifetimeDays * 0.5 * 7;
    const before = stellarSurfaceStateAt(star, model, boundary - 1e-6);
    const after = stellarSurfaceStateAt(star, model, boundary + 1e-6);
    expect(after.spotPreviousEpoch).toBe(before.spotCurrentEpoch);
    expect(before.spotPhase).toBeGreaterThan(0.999);
    expect(after.spotPhase).toBeLessThan(0.001);
  });
});
