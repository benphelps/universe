import { describe, expect, it } from 'vitest';
import { SMOOTH_MODEL, ARM_YOUNG_LIGHT } from '../../universe/galaxy/density';
import { DUST_OPACITY_PER_PC } from '../../universe/galaxy/density';
import { SHELL_WIDTH, WIND_REACH, WIND_STALL } from '../../universe/galaxy/ionization';
import { DUST_KAPPA, NEBULA_TILE, RIFT_NEAR_PC } from '../../universe/galaxy/skyfield';
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
    for (const value of [
      SMOOTH_MODEL.thinScaleLengthPc,
      SMOOTH_MODEL.thickScaleHeightPc,
      SMOOTH_MODEL.dustScaleHeightPc,
      DUST_KAPPA,
      RIFT_NEAR_PC,
      ARM_YOUNG_LIGHT,
    ]) {
      expect(glow).toContain(pinned(value));
    }
    // The nebula tile marches the region's own constants and the
    // sprite's own tile size.
    const nebula = SKY_BAKE_FRAGMENTS.nebula;
    for (const value of [DUST_OPACITY_PER_PC, 1 + SHELL_WIDTH, WIND_STALL, WIND_REACH]) {
      expect(nebula).toContain(pinned(value));
    }
    expect(nebula).toContain(`/ ${NEBULA_TILE}`);
  });
});
