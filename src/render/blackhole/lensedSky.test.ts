import { expect, it, vi } from 'vitest';
import { Color, Object3D, Scene, Vector3, WebGLCoordinateSystem, WebGLRenderTarget, type Camera, type WebGLRenderer } from 'three';
import { LensedSky } from './lensedSky';
import { registerSkyVolume } from '../fx/skyVolumeVisibility';

it.each([false, true])('captures clouds before foreground on each face and restores state (failure=%s)', fail => {
  const sky = new LensedSky(32), background = new Scene(), scene = new Scene();
  const hidden = new Object3D(), alreadyHidden = new Object3D();
  alreadyHidden.visible = false;
  const cloud = new Object3D(); background.add(cloud);
  registerSkyVolume(cloud, () => false);
  const previous = new WebGLRenderTarget(16, 16);
  const state = { target: previous, face: 3, level: 2, color: new Color(.2, .3, .4), alpha: .7 };
  const before = { ...state, color: state.color.clone() };
  const calls: { layer: Scene; face: number; clear: boolean; mipmaps: boolean; position: Vector3 }[] = [];
  const renderer = {
    coordinateSystem: WebGLCoordinateSystem, autoClear: false, xr: { enabled: true },
    getRenderTarget: () => state.target, getActiveCubeFace: () => state.face, getActiveMipmapLevel: () => state.level,
    getClearColor: (out: Color) => out.copy(state.color), getClearAlpha: () => state.alpha,
    setClearColor: (value: Color | number, alpha: number) => { state.color.set(value); state.alpha = alpha; },
    setRenderTarget: (target: WebGLRenderTarget, face = 0, level = 0) => { Object.assign(state, {target, face, level}); },
    render: vi.fn((layer: Scene, camera: Camera) => {
      expect(hidden.visible).toBe(false); expect(alreadyHidden.visible).toBe(false);
      expect(cloud.visible).toBe(layer !== background);
      calls.push({ layer, face: state.face, clear: renderer.autoClear, mipmaps: sky.target.texture.generateMipmaps,
        position: camera.getWorldPosition(new Vector3()) });
      if (fail && calls.length === 3) throw Error('capture failure');
    }),
  };
  const capture = () => sky.capture(renderer as unknown as WebGLRenderer, scene, new Vector3(2, 3, 4), [hidden, alreadyHidden], background);
  try {
    if (fail) expect(capture).toThrow('capture failure'); else capture();
    expect(state).toEqual(before); expect(renderer.autoClear).toBe(false); expect(renderer.xr.enabled).toBe(true);
    expect(hidden.visible).toBe(true); expect(alreadyHidden.visible).toBe(false); expect(cloud.visible).toBe(true);
    expect(sky.captured).toBe(!fail);
    expect(sky.target.texture.generateMipmaps).toBe(true);
    expect(sky.target.texture.userData.lensedSkyVersion).toBe(fail ? undefined : 1);
    expect(calls).toHaveLength(fail ? 3 : 12);
    calls.forEach((call, i) => {
      expect(call.layer).toBe(i % 2 ? scene : background);
      expect(call.clear).toBe(i % 2 === 0);
      expect(call.face).toBe(Math.floor(i / 2));
      expect(call.mipmaps).toBe(i === 11);
      expect(call.position.toArray()).toEqual([2, 3, 4]);
    });
  } finally { sky.dispose(); previous.dispose(); }
});
