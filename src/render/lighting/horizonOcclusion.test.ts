import { describe, expect, it } from 'vitest';
import { ShaderMaterial, Vector3 } from 'three';
import {
  applyHorizonOcclusion,
  horizonOccludesSegment,
  horizonOcclusionUniforms,
} from './horizonOcclusion';

describe('solid-body horizon occlusion', () => {
  const center = new Vector3();
  const camera = new Vector3(0, 0, 10.1);

  it('blocks a distant source whose sightline crosses the body', () => {
    expect(horizonOccludesSegment(camera, new Vector3(100, 0, -10), center, 10)).toBe(true);
  });

  it('leaves a source above the geometric limb visible', () => {
    expect(horizonOccludesSegment(camera, new Vector3(100, 0, 11), center, 10)).toBe(false);
  });

  it('does not black out a camera below the fallback sphere', () => {
    expect(
      horizonOccludesSegment(new Vector3(0, 0, 9.9), new Vector3(100, 0, 9), center, 10),
    ).toBe(false);
  });

  it('can be cleared when the focused body no longer owns the view', () => {
    const material = new ShaderMaterial({ uniforms: horizonOcclusionUniforms() });
    applyHorizonOcclusion(material, new Vector3(1, 2, 3), 10);
    expect(material.uniforms.uHorizonBodyRadius.value).toBe(10);
    expect(material.uniforms.uHorizonBodyCenter.value).toEqual(new Vector3(1, 2, 3));
    applyHorizonOcclusion(material, null, 10);
    expect(material.uniforms.uHorizonBodyRadius.value).toBe(0);
  });
});
