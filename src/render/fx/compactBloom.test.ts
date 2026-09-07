import { describe, expect, it, vi } from 'vitest';
import { DepthTexture, Mesh, ShaderMaterial, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { BLOOM_INPUT_MAX, BLOOM_LEVELS, CompactBloomPass } from './compactBloom';

describe('compact bloom', () => {
  it('uses only scene depth for occlusion and releases its intermediate targets', () => {
    const pass = new CompactBloomPass(0.18);
    const scene = new WebGLRenderTarget(100, 100, { depthTexture: new DepthTexture(100, 100) });
    const targets = new Set<WebGLRenderTarget>();
    const depthSamples: unknown[] = [];
    const renderer = {
      autoClear: true, getClearColor: () => {}, getClearAlpha: () => 1, setClearColor: () => {}, clear: () => {},
      setRenderTarget: (target: WebGLRenderTarget) => { if (target !== scene) targets.add(target); },
      render: (quad: Mesh) => {
        const material = quad.material as ShaderMaterial;
        expect(material.depthTest).toBe(false);
        expect(material.depthWrite).toBe(false);
        if (material.uniforms.depthTexture) depthSamples.push(material.uniforms.depthTexture.value);
      },
    } as unknown as WebGLRenderer;
    const released = vi.fn(), sceneReleased = vi.fn();
    scene.addEventListener('dispose', sceneReleased);
    try {
      pass.render(renderer, scene, scene);
      expect(targets.size).toBe(1 + 2 * BLOOM_LEVELS.length);
      for (const target of targets) {
        expect(target.depthBuffer).toBe(false);
        target.addEventListener('dispose', released);
      }
      expect(depthSamples).toHaveLength(2 * BLOOM_LEVELS.length);
      expect(depthSamples.every(depth => depth === scene.depthTexture)).toBe(true);
    } finally { pass.dispose(); }
    expect(released).toHaveBeenCalledTimes(targets.size);
    expect(sceneReleased).not.toHaveBeenCalled();
    scene.dispose();
  });

  it('reads the scene through a finite window', () => {
    const pass = new CompactBloomPass(0.18);
    expect(pass.brightShader).toContain(BLOOM_INPUT_MAX.toFixed(2));
    expect(pass.brightShader).toContain('isnan');
    expect(pass.brightShader).toContain('isinf');
  });

  it('rejects glare samples hidden behind foreground depth', () => {
    const pass = new CompactBloomPass(0.18);
    expect(pass.blurShader).toContain('uniform sampler2D depthTexture');
    expect(pass.blurShader).toContain('centerProximity <= 1e-7');
    expect(pass.blurShader).toContain('visibilityAt(centerProximity, uv1)');
    expect(pass.blurShader).toContain('visibilityAt(centerProximity, uv2)');
  });

  it('keeps a short pyramid whose wings fade', () => {
    expect(BLOOM_LEVELS.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < BLOOM_LEVELS.length; i++) {
      expect(BLOOM_LEVELS[i].weight).toBeLessThan(BLOOM_LEVELS[i - 1].weight);
      expect(BLOOM_LEVELS[i].kernelRadius).toBeGreaterThan(BLOOM_LEVELS[i - 1].kernelRadius);
    }
  });

  it('halves the resolution from the scene down each level', () => {
    const pass = new CompactBloomPass(0.18);
    pass.setSize(1000, 600);
    expect(pass.levelSizes).toEqual([
      [500, 300],
      [250, 150],
      [125, 75],
    ]);
  });
});
