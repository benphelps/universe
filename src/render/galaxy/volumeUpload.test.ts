import { expect, it, vi } from 'vitest';
import { Box3, Data3DTexture, HalfFloatType, RedFormat, RGBAFormat, Vector3 } from 'three';
import { VolumeUpload, VOLUME_UPLOAD_BYTES_PER_FRAME } from './volumeUpload';

it('copies every layer exactly once, including remainder slabs and mixed channel formats', () => {
  const rgba = new Data3DTexture(new Uint8Array(160 ** 3 * 4), 160, 160, 160);
  const red = new Data3DTexture(new Uint8Array(19 * 13 * 29), 19, 13, 29);
  const half = new Data3DTexture(new Uint16Array(32 * 32 * 128 * 4), 32, 32, 128);
  rgba.format = RGBAFormat; red.format = RedFormat; half.format = RGBAFormat; half.type = HalfFloatType;
  const textures = [rgba, red, half], layers = new Map(textures.map(t => [t, 0]));
  const initialized = new Set<Data3DTexture>();
  for (const texture of textures) texture.needsUpdate = true;
  const versions = textures.map(t => t.version);
  const initTexture = vi.fn((texture: Data3DTexture) => {
    expect(texture.source.dataReady).toBe(false);
    expect(initialized.has(texture)).toBe(false); initialized.add(texture);
  });
  const copyTextureToTexture = vi.fn((source: Data3DTexture, target: Data3DTexture, box: Box3, at: Vector3) => {
    expect(initialized.has(target)).toBe(true);
    expect(initialized.has(source)).toBe(false);
    expect(source.image.data).toBe(target.image.data);
    expect([source.format, source.type]).toEqual([target.format, target.type]);
    expect(target.source.dataReady).toBe(true);
    expect(box.min.toArray()).toEqual([0, 0, layers.get(target)]);
    expect(at.toArray()).toEqual(box.min.toArray());
    expect([box.max.x, box.max.y]).toEqual([target.image.width, target.image.height]);
    const bytes = (box.max.z - box.min.z) * target.image.data!.byteLength / target.image.depth;
    expect(bytes).toBeLessThanOrEqual(VOLUME_UPLOAD_BYTES_PER_FRAME);
    layers.set(target, box.max.z);
  });
  const upload = new VolumeUpload(textures);
  let ready = false;
  for (let frame = 0; !ready && frame < 100; frame++) {
    const before = initTexture.mock.calls.length + copyTextureToTexture.mock.calls.length;
    ready = upload.step({ initTexture, copyTextureToTexture });
    expect(initTexture.mock.calls.length + copyTextureToTexture.mock.calls.length - before).toBe(1);
  }
  expect(ready).toBe(true);
  for (const texture of textures) expect(layers.get(texture)).toBe(texture.image.depth);
  expect(textures.map(t => t.version)).toEqual(versions); // no later full re-upload
  upload.dispose(); for (const texture of textures) texture.dispose();
});
