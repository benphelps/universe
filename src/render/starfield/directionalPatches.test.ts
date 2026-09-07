import { describe, expect, it } from 'vitest';
import { Object3D, PerspectiveCamera, Vector3, Vector4 } from 'three';
import { DirectionalPatches } from './directionalPatches';

describe('directional sky-patch selection', () => {
  it('keeps any patch whose sampled rectangle reaches the actual camera frustum', () => {
    const directions = Array.from({ length: 48 }, (_, i) => {
      const z = -1 + 2 * (i + 0.5) / 48, angle = i * 2.399963229728653;
      const r = Math.sqrt(1 - z * z);
      return new Vector4(r * Math.cos(angle), r * Math.sin(angle), z, 0.01 + (i % 8) * 0.15);
    });
    const select = new DirectionalPatches(directions), dome = new Object3D();
    dome.rotation.set(0.3, 0.7, -0.2); dome.scale.setScalar(3); dome.updateMatrixWorld(true);
    for (const fov of [30, 55, 90, 140]) for (const aspect of [0.6, 1.5]) for (const offset of [0, 50]) {
      const camera = new PerspectiveCamera(fov, aspect, 0.1, 1e6);
      camera.position.set(offset, 0, 0); camera.lookAt(0, 0, -1000); camera.updateMatrixWorld(true);
      const visible = select.select(camera, dome, 2000);
      directions.forEach((patch, index) => {
        const dir = new Vector3(patch.x, patch.y, patch.z);
        const right = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize();
        const up = new Vector3().crossVectors(right, dir).normalize();
        for (const u of [-1, -0.5, 0, 0.5, 1]) for (const v of [-1, -0.5, 0, 0.5, 1]) {
          const point = dir.clone().addScaledVector(right, u * patch.w).addScaledVector(up, v * patch.w)
            .normalize().multiplyScalar(2000).applyMatrix4(dome.matrixWorld);
          const clip = new Vector4(point.x, point.y, point.z, 1).applyMatrix4(camera.matrixWorldInverse)
            .applyMatrix4(camera.projectionMatrix);
          if (clip.w > 0 && Math.abs(clip.x) <= clip.w && Math.abs(clip.y) <= clip.w) expect(visible).toContain(index);
        }
      });
    }
  });

  it('rejects the opposite hemisphere but retains edge-straddling patches', () => {
    const camera = new PerspectiveCamera(90, 1, 0.1, 1e5), dome = new Object3D();
    camera.updateMatrixWorld(true); dome.updateMatrixWorld(true);
    const selection = new DirectionalPatches([
      new Vector4(0, 0, -1, 0.1), new Vector4(0, 0, 1, 0.1),
      new Vector4(0.75, 0, -0.66, 0.2),
    ]);
    expect(selection.select(camera, dome, 100)).toEqual([0, 2]);
    // An exterior or nonuniformly transformed capture falls back to
    // the complete patch list rather than applying an invalid cone.
    camera.position.z = 200; camera.updateMatrixWorld(true);
    expect(selection.select(camera, dome, 100)).toEqual([0, 1, 2]);
    camera.position.z = 0; camera.updateMatrixWorld(true);
    dome.scale.x = 2; dome.updateMatrixWorld(true);
    expect(selection.select(camera, dome, 100)).toEqual([0, 1, 2]);
  });
});
