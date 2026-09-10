import { expect, it, vi } from 'vitest';
import { Mesh, ShaderMaterial, Vector3, type WebGLRenderer } from 'three';
import { giantFixture } from '../../universe/planet/__fixtures__/giants';
import { DeckBaker } from './deckBaker';
import { PlanetObject } from './planetObject';

it('reuses canonical endpoints in both time directions and agrees with a fresh visit', () => {
  const bake = vi.spyOn(DeckBaker.prototype, 'bake').mockImplementation(() => {});
  const physical = giantFixture(), body = new PlanetObject(physical);
  const renderer = {} as WebGLRenderer, light = new Vector3(0, 0, 1);
  const draw = (object: PlanetObject, t: number) => object.update(t, light, [1, 1, 1], null, renderer, { diameterPixels: 300, daysPerSecond: 0 });
  const uniforms = (object: PlanetObject) => ((object.group.children[0] as Mesh).material as ShaderMaterial).uniforms;
  try {
    draw(body, 100);
    const start = bake.mock.calls[0][2], end = bake.mock.calls[1][2], dt = end - start;
    draw(body, start + dt * .8);
    expect(bake).toHaveBeenCalledTimes(2);
    draw(body, end + dt * .2);
    expect(bake).toHaveBeenCalledTimes(3);
    draw(body, start + dt * .8);
    expect(bake).toHaveBeenCalledTimes(4);
    expect(uniforms(body).uDeckMix.value).toBeCloseTo(.8);
    draw(body, start - dt * .2);
    expect(bake).toHaveBeenCalledTimes(5);
    expect(uniforms(body).uDeckMix.value).toBeCloseTo(.8);
    const fresh = new PlanetObject(physical);
    draw(fresh, start - dt * .2);
    expect(bake.mock.calls.at(-2)![2]).toBe(bake.mock.calls.at(-3)![2]);
    expect(uniforms(fresh).uDeckMix.value).toBe(uniforms(body).uDeckMix.value);
    fresh.dispose();
  } finally { body.dispose(); bake.mockRestore(); }
});


it('keeps storm spiral harmonics continuous across their wrapped phase', async () => {
  const { giantWeatherUniforms, updateGiantWeather } = await import('./giantWeather');
  const { deriveCirculation } = await import('../../universe/planet/circulation');
  const circulation = deriveCirculation(giantFixture());
  const uniforms = giantWeatherUniforms(circulation);
  expect(uniforms.uWeatherTime.value.z + uniforms.uWeatherTime.value.w).toBe(1);
  for (const halfTurns of [1, 2, 3, 4, 10]) {
    const t = halfTurns * Math.PI / (circulation.churnPerDay * .22);
    updateGiantWeather(uniforms, circulation, t - 1e-5);
    const before = uniforms.uStormPhase.value;
    updateGiantWeather(uniforms, circulation, t + 1e-5);
    const after = uniforms.uStormPhase.value;
    expect(Math.abs(Math.sin(before * .5) - Math.sin(after * .5))).toBeLessThan(1e-5);
    expect(Math.abs(Math.cos(before) - Math.cos(after))).toBeLessThan(1e-5);
  }
});
