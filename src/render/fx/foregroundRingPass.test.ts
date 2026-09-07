import { describe, expect, it, vi } from 'vitest';
import { Mesh, PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { ForegroundRingPass } from './foregroundRingPass';
import { createRingMesh } from '../planet/ringMaterial';

function ring(): Mesh {
  return createRingMesh({ innerPlanetRadii: 1.3, outerPlanetRadii: 2.5, opticalDepth: 0.1,
    composition: 'dusty', hue: [0.3, 0.2, 0.1], albedo: 0.1, gaps: [], forwardScatter: 1 }, 1000);
}
function dispose(mesh: Mesh) { mesh.geometry.dispose(); (mesh.material as ShaderMaterial).dispose(); }

describe('rings around depth-composited clouds', () => {
  it('keeps ordinary and cloudless rings in the beauty pass', () => {
    const pass = new ForegroundRingPass(new PerspectiveCamera()), source = ring();
    const material = source.material as ShaderMaterial;
    pass.setRing(source, 0);
    expect(pass.enabled).toBe(false);
    expect(material.uniforms.uRingCloudPass.value).toBe(0);
    expect(material.depthWrite).toBe(false);
    expect(material.forceSinglePass).toBe(true);
    dispose(source);
  });

  it('blends foreground fragments into the cloud result with its solid depth intact', () => {
    const camera = new PerspectiveCamera(), pass = new ForegroundRingPass(camera), source = ring();
    source.rotation.x = -Math.PI / 2; source.updateMatrixWorld(true);
    const material = source.material as ShaderMaterial, target = new WebGLRenderTarget();
    pass.setRing(source, 1020);
    expect(pass.needsSwap).toBe(false);
    expect(material.uniforms.uRingCloudPass.value).toBe(1);
    const renderer = { autoClear: true, setRenderTarget: vi.fn(), render: vi.fn((scene: Scene, view) => {
      const proxy = scene.children[0] as Mesh;
      expect(view).toBe(camera);
      expect(proxy.matrix).toEqual(source.matrixWorld);
      expect(proxy.geometry).toBe(source.geometry);
      expect(proxy.material).toBe(source.material);
      expect(material.uniforms.uRingCloudPass.value).toBe(2);
      expect(renderer.autoClear).toBe(false);
    }) };
    pass.render(renderer as unknown as WebGLRenderer, target, target);
    expect(renderer.setRenderTarget).toHaveBeenCalledExactlyOnceWith(target);
    expect(material.uniforms.uRingCloudPass.value).toBe(1);
    expect(renderer.autoClear).toBe(true);
    pass.dispose(); target.dispose(); dispose(source);
  });

  it('restores pass state on failure and releases borrowed resources on focus change', () => {
    const pass = new ForegroundRingPass(new PerspectiveCamera()), a = ring(), b = ring();
    const material = a.material as ShaderMaterial, target = new WebGLRenderTarget();
    pass.setRing(a, 1020);
    const renderer = { autoClear: false, setRenderTarget: vi.fn(), render: () => { throw Error('render'); } };
    expect(() => pass.render(renderer as unknown as WebGLRenderer, target, target)).toThrow('render');
    expect(material.uniforms.uRingCloudPass.value).toBe(1);
    expect(renderer.autoClear).toBe(false);
    pass.setRing(b, 1040);
    expect(material.uniforms.uRingCloudPass.value).toBe(0);
    expect(material.uniforms.uRingCloudRadius.value).toBe(0);
    const release = vi.spyOn(b.geometry, 'dispose');
    pass.dispose();
    expect(release).not.toHaveBeenCalled();
    expect((b.material as ShaderMaterial).uniforms.uRingCloudPass.value).toBe(0);
    target.dispose(); dispose(a); dispose(b);
  });
});
