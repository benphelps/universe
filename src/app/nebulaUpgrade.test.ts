import { beforeEach, expect, it, vi } from 'vitest';
import { UnifiedViewer } from './unifiedViewer';
import { NebulaResidentBudget, nebulaResidentBytes } from './nebulaMemory';
import { Data3DTexture, Mesh, Scene } from 'three';
import { NebulaVolume } from '../render/galaxy/nebulaVolume';
import type { VolumeUpload } from '../render/galaxy/volumeUpload';
import type { MolecularCloud } from '../universe/galaxy/clouds';
import type { GalacticPosition } from '../universe/galaxy/density';
import type { NebulaVolumeBake } from '../universe/galaxy/nebulaVolume';

const { pending, requests } = vi.hoisted(() => ({ pending: new Map<bigint, number>(), requests: vi.fn() }));
const sky = vi.hoisted(() => ({ pending: 0 }));
const ownership = vi.hoisted(() => ({ hold: vi.fn(), release: vi.fn() }));
vi.mock('../render/galaxy/nebulaVolume', async importOriginal => ({
  ...await importOriginal<typeof import('../render/galaxy/nebulaVolume')>(),
  NebulaVolume: class {
    bakedSize: number; hasFine: boolean; fade = .7; opacity = .7; retiring = false;
    ready = true; prepare = vi.fn();
    box = { halfPc: 20, volume: new Data3DTexture(), fine: new Data3DTexture(),
      occupancy: new Data3DTexture(), continuum: new Data3DTexture() };
    mesh = new Mesh(); cameraDistancePc = 100;
    dispose = vi.fn(); setInstrument = vi.fn();
    constructor(bake: NebulaVolumeBake, fine: NebulaVolumeBake | null) { this.bakedSize = bake.size; this.hasFine = !!fine; }
  },
}));
vi.mock('./skyService', () => ({ skyPending: () => sky.pending }));
vi.mock('./nebulaService', () => ({
  pendingNebulaBakes: () => pending.size,
  pendingNebulaGrade: (cloud: MolecularCloud) => pending.get(cloud.seed) ?? 0,
  nebulaWorkingBytes: () => 1,
  nebulaDomains: () => 2,
  shelvedNebulaVolume: () => null,
  requestNebulaPair: (cloud: MolecularCloud, size: number) => { pending.set(cloud.seed, size); requests(cloud.seed, size); return null; },
  holdNebulaVolume: ownership.hold,
  releaseNebulaVolume: ownership.release,
}));
beforeEach(() => { pending.clear(); requests.mockClear(); ownership.hold.mockClear(); ownership.release.mockClear(); sky.pending = 0; });
// Exercise the viewer's scheduling/arrival methods without constructing a
// WebGL renderer. The carrier has the actual array-shaped merged uniform.
type Probe = {
  nebulaVolumes: Map<bigint, { bakedSize: number; retiring: boolean; box: { halfPc: number }; cameraDistancePc: number; mesh: unknown }>;
  residentClouds: Map<bigint, MolecularCloud>;
  nebulaMemory: NebulaResidentBudget;
  focusCloud: null;
  viewpointPc: GalacticPosition;
  wantedNebulae: Set<bigint>;
  coarseBakes: Map<bigint, NebulaVolumeBake>;
  fineBakes: Map<bigint, NebulaVolumeBake>;
  heldBakes: Map<bigint, NebulaVolumeBake[]>;
  nebulaUploads: Map<bigint, { volume: NebulaVolume; held: NebulaVolumeBake[]; upload: VolumeUpload }>;
  pipeline: { renderer: object; sky: { scene: Scene } };
  climbNebulaGrade(orientation: Float32Array): void;
  installNebulaVolume(seed: bigint, viewpoint: GalacticPosition, orientation: Float32Array): void;
  advanceNebulaUpload(): void;
  cancelNebulaUpload(seed: bigint, settle?: boolean): void;
  nebulaBakesSettled(): boolean;
};
function viewer(): Probe {
  const result = Object.create(UnifiedViewer.prototype) as Probe;
  Object.assign(result, { nebulaVolumes: new Map(), residentClouds: new Map(), nebulaMemory: new NebulaResidentBudget(),
    focusCloud: null, viewpointPc: { xPc: 0, yPc: 0, zPc: 0 }, wantedNebulae: new Set(), coarseBakes: new Map(),
    fineBakes: new Map(), heldBakes: new Map(), nebulaUploads: new Map(), pipeline: { renderer: {}, sky: { scene: new Scene() } } });
  for (const [seed, halfPc] of [[1n, 20], [2n, 70], [3n, 80], [4n, 30]] as const) {
    result.nebulaVolumes.set(seed, { bakedSize: 48, retiring: false, box: { halfPc }, cameraDistancePc: 100,
      mesh: { material: { uniforms: { uHalfPc: { value: [halfPc, 0, 0, 0] } } } } });
    result.residentClouds.set(seed, { seed } as MolecularCloud);
    result.wantedNebulae.add(seed); result.nebulaMemory.reserve(seed, 48);
  }
  return result;
}

it('fills three upgrade lanes by apparent size, selects near grades, and never duplicates in-flight jobs', () => {
  const v = viewer();
  v.climbNebulaGrade(new Float32Array());
  expect(requests.mock.calls).toEqual([[3n, 160], [2n, 160], [4n, 96]]);
  v.climbNebulaGrade(new Float32Array());
  expect(requests).toHaveBeenCalledTimes(3);
  pending.delete(4n); v.nebulaVolumes.get(4n)!.bakedSize = 96;
  v.climbNebulaGrade(new Float32Array());
  expect(requests.mock.lastCall).toEqual([1n, 96]);
});

function stage(v: Probe, size: number): NebulaVolumeBake {
  const bake = { size } as NebulaVolumeBake;
  v.coarseBakes.set(1n, bake);
  v.nebulaMemory.reserve(1n, size, 1, nebulaResidentBytes(48, 1));
  v.installNebulaVolume(1n, v.viewpointPc, new Float32Array());
  v.coarseBakes.clear();
  return bake;
}

it('retains the visible grid and its lease through partial uploads, then swaps the complete pair', () => {
  const v = viewer(), oldBake = { size: 48 } as NebulaVolumeBake;
  const old = new NebulaVolume(oldBake, null, v.viewpointPc, new Float32Array());
  v.nebulaVolumes.set(1n, old); v.pipeline.sky.scene.add(old.mesh); v.heldBakes.set(1n, [oldBake]);
  const bake = stage(v, 160), replacement = v.nebulaUploads.get(1n)!;
  vi.spyOn(replacement.upload, 'step').mockReturnValueOnce(false).mockReturnValue(true);
  const reservation = v.nebulaMemory.bytes;
  v.advanceNebulaUpload();
  expect(v.nebulaVolumes.get(1n)).toBe(old);
  expect(v.pipeline.sky.scene.children).toContain(old.mesh);
  expect(old.dispose).not.toHaveBeenCalled(); expect(ownership.release).not.toHaveBeenCalled();
  expect(v.nebulaBakesSettled()).toBe(false);
  v.advanceNebulaUpload();
  expect(v.nebulaVolumes.get(1n)).toBe(replacement.volume);
  expect(v.pipeline.sky.scene.children).toContain(replacement.volume.mesh);
  expect(v.pipeline.sky.scene.children).not.toContain(old.mesh);
  expect(replacement.volume.fade).toBe(old.fade);
  expect(old.dispose).toHaveBeenCalledOnce(); expect(ownership.release).toHaveBeenCalledExactlyOnceWith(oldBake);
  expect(v.heldBakes.get(1n)).toEqual([bake]); expect(v.nebulaUploads.size).toBe(0);
  expect(v.nebulaMemory.bytes).toBe(reservation - nebulaResidentBytes(48, 1));
});

it('disposes an overtaken upload, ignores late lower grades and cancels without releasing the visible grid', () => {
  const v = viewer(), original = v.nebulaVolumes.get(1n);
  const coarse = stage(v, 96), first = v.nebulaUploads.get(1n)!;
  const fine = stage(v, 160), second = v.nebulaUploads.get(1n)!;
  expect(first.volume.dispose).toHaveBeenCalledOnce();
  expect(ownership.release).toHaveBeenCalledExactlyOnceWith(coarse);
  v.coarseBakes.set(1n, coarse); v.installNebulaVolume(1n, v.viewpointPc, new Float32Array());
  expect(v.nebulaUploads.get(1n)).toBe(second);
  v.cancelNebulaUpload(1n); v.cancelNebulaUpload(1n);
  expect(second.volume.dispose).toHaveBeenCalledOnce();
  expect(ownership.release.mock.calls).toEqual([[coarse], [fine]]);
  expect(v.nebulaVolumes.get(1n)).toBe(original);
  expect(v.nebulaUploads.size).toBe(0);
});

it('does not request duplicate upgrades while a completed bake is still uploading', () => {
  const v = viewer(); stage(v, 160);
  v.climbNebulaGrade(new Float32Array());
  expect(requests.mock.calls.map(call => call[0])).not.toContain(1n);
});

it('preserves a higher in-flight reservation when the first grid becomes visible', () => {
  const v = viewer(); v.nebulaVolumes.delete(1n);
  pending.set(1n, 160);
  v.nebulaMemory.reserve(1n, 160, 1, nebulaResidentBytes(48, 1));
  const before = v.nebulaMemory.bytes;
  stage(v, 48);
  vi.spyOn(v.nebulaUploads.get(1n)!.upload, 'step').mockReturnValue(true);
  v.advanceNebulaUpload();
  expect(v.nebulaMemory.bytes).toBe(before);
  expect(v.nebulaVolumes.get(1n)!.bakedSize).toBe(48);
});

it('keeps a standing fine grid when a late first arrival completes', () => {
  const v = viewer(), volume = v.nebulaVolumes.get(1n)!;
  volume.bakedSize = 160;
  v.coarseBakes.set(1n, { size: 48 } as NebulaVolumeBake);
  v.installNebulaVolume(1n, v.viewpointPc, new Float32Array());
  expect(v.nebulaVolumes.get(1n)).toBe(volume);
  expect(volume.bakedSize).toBe(160);
});

it('leaves a portrait-mapping gap free for the next sky solve', () => {
  const v = viewer(); sky.pending = 1;
  v.climbNebulaGrade(new Float32Array());
  expect(requests).not.toHaveBeenCalled();
  sky.pending = 0;
  v.climbNebulaGrade(new Float32Array());
  expect(requests).toHaveBeenCalledTimes(3);
});

it('keeps the old grid and its memory reservation until both upload and shader preparation finish', () => {
  const v = viewer(), old = new NebulaVolume({ size: 48 } as NebulaVolumeBake, null, v.viewpointPc, new Float32Array());
  v.nebulaVolumes.set(1n, old);
  stage(v, 96);
  const next = v.nebulaUploads.get(1n)!;
  Object.defineProperty(next.volume, 'ready', { value: false, configurable: true });
  vi.spyOn(next.upload, 'step').mockReturnValue(true);
  const reserved = v.nebulaMemory.bytes;
  v.advanceNebulaUpload();
  expect(v.nebulaVolumes.get(1n)).toBe(old);
  expect(v.nebulaMemory.bytes).toBe(reserved);
  expect(ownership.release).not.toHaveBeenCalled();
  Object.defineProperty(next.volume, 'ready', { value: true });
  v.advanceNebulaUpload();
  expect(v.nebulaVolumes.get(1n)).toBe(next.volume);
});
