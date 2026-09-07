import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { selectShadowCasters } from './shadows';

describe('eclipse caster selection', () => {
  it('keeps a fifth moon or distant planet crossing the star ahead of unrelated moons', () => {
    const misses = Array.from({ length: 5 }, (_, i) => ({
      position: new Vector3(10, 10 + i, 0),
      radius: 0.1,
    }));
    const planet = { position: new Vector3(100, 0, 0), radius: 1 };
    const selected = selectShadowCasters(
      [...misses, planet],
      new Vector3(),
      new Vector3(1, 0, 0),
      0.005,
      1000,
    );
    expect(selected[0]).toBe(planet);
    expect(selected).toHaveLength(4);
  });
  it('excludes bodies behind the observer or beyond the star', () => {
    const candidates = [-10, 1100].map((x) => ({ position: new Vector3(x, 0, 0), radius: 2 }));
    expect(
      selectShadowCasters(candidates, new Vector3(), new Vector3(1, 0, 0), 0.005, 1000),
    ).toEqual([]);
  });
});
