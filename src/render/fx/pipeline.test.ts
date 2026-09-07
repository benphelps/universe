import { expect, it, vi } from 'vitest';
import { Camera, Group, Scene, WebGLRenderTarget } from 'three';
import { RenderPipeline } from './pipeline';

it('warms the HDR shader variant and restores the active target immediately', async () => {
  const old = new WebGLRenderTarget(), hdr = new WebGLRenderTarget();
  const camera = new Camera(), scene = new Scene(), object = new Group();
  let target = old;
  const setRenderTarget = vi.fn(next => { target = next; });
  let finish!: () => void;
  const compileAsync = vi.fn((group, view, destination) => {
    expect(target).toBe(hdr);
    expect([group, view, destination]).toEqual([object, camera, scene]);
    return new Promise<void>(resolve => { finish = resolve; });
  });
  const pipeline = { renderer: { getRenderTarget: () => old, getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 3, setRenderTarget, compileAsync }, composer: { readBuffer: hdr }, camera,
    preparations: new Set(),
  } as unknown as RenderPipeline;
  const pending = RenderPipeline.prototype.prepareSceneObject.call(pipeline, object, scene);
  expect(setRenderTarget).toHaveBeenLastCalledWith(old, 2, 3);
  expect(target).toBe(old);
  finish(); await pending;
  old.dispose(); hdr.dispose();
});

it('retains renderer state through asynchronous compilation and disposes it once', async () => {
  vi.useFakeTimers();
  try {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const releaseResources = vi.fn(), remove = vi.fn();
    const pipeline = { preparations: new Set([pending]), releaseResources,
      renderer: { domElement: { remove } } } as unknown as RenderPipeline;
    RenderPipeline.prototype.dispose.call(pipeline);
    RenderPipeline.prototype.dispose.call(pipeline);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(releaseResources).not.toHaveBeenCalled();
    finish();
    await vi.runAllTimersAsync();
    expect(releaseResources).toHaveBeenCalledTimes(1);
    const object = new Group();
    expect(await RenderPipeline.prototype.prepareSceneObject.call(pipeline, object, new Scene())).toBe(object);
  } finally { vi.useRealTimers(); }
});
