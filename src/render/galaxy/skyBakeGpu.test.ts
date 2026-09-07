import { GALAXY_COMPONENT_GLSL } from '../glsl/galaxyComponents';
import { describe, expect, it } from 'vitest';
import { SMOOTH_MODEL } from '../../universe/galaxy/density';
import { DUST_OPACITY_PER_PC } from '../../universe/galaxy/density';
import { DUST_KAPPA, NEBULA_TILE, NEBULA_TILE_MAX_STEPS, RIFT_NEAR_PC } from '../../universe/galaxy/skyfield';
import { SKY_BAKE_FRAGMENTS } from './skyBakeGpu';

function pinned(value: number): string {
  return value.toPrecision(9).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0');
}

function declaredUniforms(source: string): string[] {
  return [...source.matchAll(/^uniform\s+\S+\s+(\w+)\s*;/gm)].map((match) => match[1]);
}

describe('the sky bake shaders', () => {
  it('use every uniform they declare', () => {
    for (const [name, source] of Object.entries(SKY_BAKE_FRAGMENTS)) {
      const body = source.replace(/^uniform\s+.*$/gm, '');
      const unused = declaredUniforms(source).filter((uniform) => !body.includes(uniform));
      expect(unused, name).toEqual([]);
    }
  });

  it('read the smooth model and the sky constants rather than restating them', () => {
    // The glow integrates the CPU model's own numbers: the scale
    // lengths, the dust opacity, the cloud-shadow radius and the arm
    // light weight all have to appear as the model states them.
    const glow = SKY_BAKE_FRAGMENTS.glow;
    expect(glow).toContain(GALAXY_COMPONENT_GLSL);
    for (const value of [
      SMOOTH_MODEL.thinScaleLengthPc / 1000,
      SMOOTH_MODEL.thickScaleHeightPc / 1000,
      SMOOTH_MODEL.dustScaleHeightPc,
      DUST_KAPPA,
      RIFT_NEAR_PC,
    ]) {
      expect(glow).toContain(pinned(value));
    }
    // Nebula geometry comes from the solved volume texture, with a
    // shared opacity and a bounded march at each grid's cell scale.
    const nebula = SKY_BAKE_FRAGMENTS.nebula;
    expect(nebula).toContain(pinned(DUST_OPACITY_PER_PC));
    expect(nebula).toContain(`/${pinned(NEBULA_TILE)}`);
    expect(nebula).toContain(`step < ${NEBULA_TILE_MAX_STEPS}`);
  });
});
