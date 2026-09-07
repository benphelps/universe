import { expect, it, vi } from 'vitest';
import { Data3DTexture, ShaderMaterial } from 'three';
import { NebulaCarrier } from './nebulaVolume';
const frame = new Float32Array([1,0,0,0,1,0,0,0,1]);
const viewpoint = {xPc:0,yPc:0,zPc:0};

it('waits before drawing and drops borrowed grids on departure during preparation', async () => {
  const carrier = new NebulaCarrier(viewpoint, frame);
  const material = carrier.mesh.material as ShaderMaterial;
  const largeGrid = new Data3DTexture(new Uint8Array(128),2,2,2);
  material.uniforms.uVolume.value[0] = largeGrid;
  const dispose = vi.spyOn(material, 'dispose');
  let finish!: () => void;
  carrier.prepare(() => new Promise<void>(resolve => { finish=resolve; }));
  await Promise.resolve();
  carrier.opacity=1;
  expect(carrier.ready).toBe(false); expect(carrier.mesh.visible).toBe(false);
  carrier.dispose(); carrier.dispose();
  expect(material.uniforms.uVolume.value).not.toContain(largeGrid);
  expect(dispose).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(()=>expect(dispose).toHaveBeenCalledTimes(1));
  expect(carrier.mesh.visible).toBe(false);
  largeGrid.dispose();
});

it('publishes a ready carrier on the next opacity update without recreating it', async () => {
  const carrier = new NebulaCarrier(viewpoint, frame);
  carrier.prepare(async()=>{});
  await vi.waitFor(()=>expect(carrier.ready).toBe(true));
  carrier.opacity=.5; expect(carrier.mesh.visible).toBe(true);
  carrier.dispose(); carrier.opacity=1; expect(carrier.mesh.visible).toBe(false);
});
