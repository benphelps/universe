import { afterEach, expect, it, vi } from 'vitest';
import { Object3D, PerspectiveCamera, Scene, Vector3, Vector4, type WebGLRenderer } from 'three';
import { registerSkyVolume, setSkyVolumeCulling, sphereInViewCone } from './skyVolumeVisibility';
import { SkyLayer } from './skyLayer';

it('bounds adaptive volume sampling and restores the original target dimensions', () => {
  const layer = new SkyLayer();
  try {
    layer.setSize(1120, 1000, 2);
    const texture = (layer.quad.material as import('three').ShaderMaterial).uniforms.uSky.value;
    const original = [texture.image.width, texture.image.height];
    for (let i = 0; i < 100; i++) layer.shiftSampling(1);
    expect(layer.sampleCssPx).toBe(2);
    expect(texture.image.width).toBeGreaterThanOrEqual(560);
    expect(texture.image.height).toBeGreaterThanOrEqual(500);
    for (let i = 0; i < 100; i++) layer.shiftSampling(-1);
    expect(layer.sampleCssPx).toBe(1.4);
    expect([texture.image.width, texture.image.height]).toEqual(original);
  } finally { layer.dispose(); }
});

afterEach(() => setSkyVolumeCulling(true));

it('retains every sampled box that reaches the camera frustum', () => {
  const forward = new Vector3(0, 0, -1);
  for (const fov of [30, 55, 90, 140]) {
    const camera = new PerspectiveCamera(fov, 1.4, 0.1, 1e6);
    const view = Math.atan(Math.tan(fov * Math.PI / 360) * Math.hypot(1, 1.4));
    for (let a = 0; a < 360; a += 10) for (const half of [2, 20, 200]) {
      const angle = a * Math.PI / 180;
      const centre = new Vector3(Math.sin(angle) * 100, Math.cos(angle * 3) * 50, Math.cos(angle) * 100);
      const visible = sphereInViewCone(centre, Math.sqrt(3) * half, forward, view);
      for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
        const clip = new Vector4(centre.x + x * half, centre.y + y * half, centre.z + z * half, 1)
          .applyMatrix4(camera.projectionMatrix);
        if (clip.w > 0 && Math.abs(clip.x) <= clip.w && Math.abs(clip.y) <= clip.w) expect(visible).toBe(true);
      }
    }
  }
  expect(sphereInViewCone(new Vector3(0, 0, 100), 10, forward, 0.5)).toBe(false);
});

it.each([false, true])('culls only the current draw and restores capture visibility (throw=%s)', (fail) => {
  const layer = new SkyLayer(), camera = new PerspectiveCamera();
  const front = new Object3D(), behind = new Object3D(), hidden = new Object3D();
  hidden.visible = false;
  layer.scene.add(front, behind, hidden);
  registerSkyVolume(behind, () => false);
  const render = vi.fn(() => {
    expect(front.visible).toBe(true); expect(behind.visible).toBe(false); expect(hidden.visible).toBe(false);
    if (fail) throw new Error('draw failure');
  });
  const renderer = {
    autoClear: true, getRenderTarget: () => null, getClearColor: () => {}, getClearAlpha: () => 1,
    setClearColor: vi.fn(), setRenderTarget: vi.fn(), clear: vi.fn(), render,
  } as unknown as WebGLRenderer;
  try {
    if (fail) expect(() => layer.render(renderer, camera)).toThrow('draw failure');
    else layer.render(renderer, camera);
    expect(behind.visible).toBe(true); expect(hidden.visible).toBe(false);
    expect(renderer.autoClear).toBe(true);
    const borrowed = layer.lendTo(new Scene(), new Vector3());
    expect(borrowed).toContain(behind); expect(behind.visible).toBe(true);
    layer.reclaim(borrowed);
  } finally { layer.dispose(); }
});
