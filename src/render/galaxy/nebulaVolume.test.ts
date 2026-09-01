import { describe, expect, it } from 'vitest';
import { NEBULA_FRAGMENT } from './nebulaVolume';

/** Every uniform the shader declares, in declaration order. */
function declaredUniforms(source: string): string[] {
  return [...source.matchAll(/^uniform\s+\S+\s+(\w+)\s*;/gm)].map((match) => match[1]);
}

describe('the volume shader', () => {
  it('uses every uniform it declares', () => {
    // The failure this catches actually happened: the fine H II volume
    // was baked, uploaded, and bound to uniforms the shader never read,
    // so a cloud drew its dust and lost its nebula. Tests over the two
    // bakes could not see it — each was correct on its own, and only
    // the wiring between them was missing.
    const body = NEBULA_FRAGMENT.replace(/^uniform\s+.*$/gm, '');
    const unused = declaredUniforms(NEBULA_FRAGMENT).filter((name) => !body.includes(name));
    expect(unused).toEqual([]);
  });

  it('reads the fine volume where the ray crosses it', () => {
    // The bubble is sampled from its own texture, with its own
    // reference densities and its own emission coefficient — not the
    // cloud-scale ones, which carry no ionized gas at all.
    expect(NEBULA_FRAGMENT).toMatch(/texture\(\s*uFine\s*,/);
    expect(NEBULA_FRAGMENT).toContain('uFineDensityRef');
    expect(NEBULA_FRAGMENT).toContain('uFineEmissionCoefficient');
  });
});
