import { describe, expect, it, vi } from 'vitest';
import { AlwaysDepth, NeverDepth, BufferGeometry, DepthTexture, Mesh, PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderTarget, Matrix4, type WebGLRenderer } from 'three';
import { CloudPass } from './cloudPass';
import { cloudShellBounds } from '../terrain/cloudShell';
import type { Characterization } from '../../universe/planet/types';

function shell(): Mesh {
  return new Mesh(new BufferGeometry(), new ShaderMaterial({ uniforms: {
    uSceneColor: { value: null }, uSceneDepth: { value: null }, uInverseProjection: { value: new Matrix4() },
  } }));
}

describe('depth-clipped clouds', () => {
  it('retains a low modeled deck instead of collapsing it at the highest terrain', () => {
    const physical = { atmosphere: { class: 'nitrogen-methane' },
      appearance: { clouds: { coverage: 0.15, topAltitudeKm: 3.14, thicknessKm: 1.2 } },
    } as Characterization;
    expect(cloudShellBounds(physical)).toEqual({ topKm: 3.14, baseKm: 1.9400000000000002 });
    physical.atmosphere.class = 'none';
    expect(cloudShellBounds(physical)).toBeNull();
  });

  it.each([false, true])('borrows beauty buffers and requests an unconditional depth write (reversed=%s)', reversed => {
    const camera = new PerspectiveCamera(55, 1.4, 0.001, 40000), pass = new CloudPass(camera);
    const source = new WebGLRenderTarget(64, 64, { depthTexture: new DepthTexture(64, 64) });
    const destination = source.clone(), mesh = shell(), material = mesh.material as ShaderMaterial;
    const renderer = { capabilities: { reversedDepthBuffer: reversed }, autoClear: true, setRenderTarget: vi.fn(), render: vi.fn((scene: Scene, view) => {
      expect(scene.children).toEqual([mesh]); expect(view).toBe(camera);
      expect(renderer.autoClear).toBe(false);
    }) };
    expect(pass.enabled).toBe(false);
    pass.setShell(mesh);
    expect(pass.needsSwap).toBe(true);
    pass.render(renderer as unknown as WebGLRenderer, destination, source);
    expect(renderer.setRenderTarget).toHaveBeenCalledExactlyOnceWith(destination);
    expect(material.depthFunc).toBe(reversed ? NeverDepth : AlwaysDepth);
    expect(material.uniforms.uSceneColor.value).toBe(source.texture);
    expect(material.uniforms.uSceneDepth.value).toBe(source.depthTexture);
    expect(material.uniforms.uInverseProjection.value).toEqual(camera.projectionMatrixInverse);
    expect(renderer.autoClear).toBe(true);
    const dispose = vi.spyOn(material, 'dispose');
    pass.dispose();
    expect(mesh.parent).toBeNull(); expect(pass.enabled).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    source.dispose(); destination.dispose(); material.dispose(); mesh.geometry.dispose();
  });

  it('detaches the old body and restores renderer state even if rendering fails', () => {
    const pass = new CloudPass(new PerspectiveCamera()), a = shell(), b = shell();
    const target = new WebGLRenderTarget();
    pass.setShell(a); pass.setShell(b);
    expect(a.parent).toBeNull(); expect(b.parent).not.toBeNull();
    const renderer = { capabilities: { reversedDepthBuffer: false }, autoClear: true, setRenderTarget: () => {}, render: () => { throw new Error('render'); } };
    expect(() => pass.render(renderer as unknown as WebGLRenderer, target, target)).toThrow('render');
    expect(renderer.autoClear).toBe(true);
    pass.setShell(null);
    expect(b.parent).toBeNull();
    pass.render(renderer as unknown as WebGLRenderer, target, target);
    for (const mesh of [a, b]) { mesh.geometry.dispose(); (mesh.material as ShaderMaterial).dispose(); }
    target.dispose();
  });
});
