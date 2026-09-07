import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mesh, Scene, ShaderMaterial, Vector3 } from 'three';
import type { Characterization } from '../../universe/planet/types';
import type { GridSurvey } from '../../universe/surface/field';
import type { TerrainRequest, TerrainResponse } from '../../workers/protocol';
import { TerrainChunkManager } from './chunkManager';

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<TerrainResponse>) => void) | null = null;
  readonly messages: TerrainRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: TerrainRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: TerrainResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<TerrainResponse>);
  }
}

function survey(): GridSurvey {
  return {
    cellHeightsM: new Float32Array(1),
    oceanMask: new Uint8Array(1),
    tempK: new Float32Array(1),
    precipMmYr: new Float32Array(1),
    flowTo: new Int32Array(1),
    dischargeM3s: new Float32Array(1),
    spillM: new Float32Array(1),
    bedM: new Float32Array(1),
    stageM: new Float32Array(1),
    lakeM: new Float32Array(1),
    riverMinM3s: 0,
  };
}

afterEach(() => {
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
});

describe('terrain worker initialization', () => {
  it('builds one survey and installs it before dispatching chunks', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    vi.stubGlobal('Worker', FakeWorker);
    const onSurvey = vi.fn();
    const manager = new TerrainChunkManager(
      new Scene(),
      new ShaderMaterial(),
      null,
      null,
      { type: 'init', seedHex: '0123456789abcdef', physical: {} as Characterization },
      6_371,
      [],
      onSurvey,
    );

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0].messages).toEqual([
      expect.objectContaining({ type: 'init', survey: 'report' }),
    ]);
    expect(FakeWorker.instances[1].messages).toEqual([
      expect.objectContaining({ type: 'init', survey: 'defer' }),
    ]);

    manager.update(new Vector3(0, 0, 12_742));
    expect(FakeWorker.instances.flatMap((worker) => worker.messages)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'chunk' })]),
    );

    const builtSurvey = survey();
    FakeWorker.instances[0].emit({ type: 'survey', survey: builtSurvey });
    expect(onSurvey).toHaveBeenCalledWith(builtSurvey);
    expect(FakeWorker.instances[1].messages[1]).toEqual({
      type: 'install-survey',
      survey: builtSurvey,
    });
    expect(FakeWorker.instances.flatMap((worker) => worker.messages)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'chunk' })]),
    );

    manager.dispose();
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });
});

it('installs fluid morph data and shares the terrain transition reference without another copy', () => {
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
  vi.stubGlobal('Worker', FakeWorker);
  const scene = new Scene(), ground = new ShaderMaterial(), water = new ShaderMaterial();
  const manager = new TerrainChunkManager(scene, ground, water, null,
    { type: 'init', seedHex: '0123456789abcdef', physical: {} as Characterization }, 6371);
  try {
    manager.update(new Vector3(0, 0, 1e6));
    FakeWorker.instances[0].emit({ type: 'survey', survey: null });
    const worker = FakeWorker.instances.find(w => w.messages.some(m => m.type === 'chunk'))!;
    const request = worker.messages.find(m => m.type === 'chunk')!;
    if (request.type !== 'chunk') throw Error('Expected a requested terrain tile');
    expect(request.level).toBe(0);
    worker.emit({ type: 'chunk', id: request.id, centerKm: [0, 0, 6371],
      positions: new Float32Array([0, 0, 0]), normals: new Float32Array([0, 0, 1]),
      colors: new Float32Array([0.3, 0.3, 0.3]), morph: new Float32Array([1, 2, 3, 100]),
      waterPositions: new Float32Array([0, 0, -0.02]), waterNormals: new Float32Array([0, 0, 1]),
      waterMorph: new Float32Array([4, 5, 6]), waterIce: null, scatter: null });
    const terrain = scene.children.find(o => o instanceof Mesh && o.material === ground) as Mesh;
    const fluid = scene.children.find(o => o instanceof Mesh && o.material === water) as Mesh;
    expect(fluid.geometry.getAttribute('aTerrainPosition')).toBe(terrain.geometry.getAttribute('position'));
    expect(fluid.geometry.getAttribute('aMorph')).toBe(terrain.geometry.getAttribute('aMorph'));
    expect(Array.from(fluid.geometry.getAttribute('aWaterMorph').array)).toEqual([0, 0, 0]);
  } finally { manager.dispose(); ground.dispose(); water.dispose(); }
});

// Complete requested tiles without evaluating the planetary field. This
// exercises the real traversal and parent/child visibility decisions.
interface TileProbe { level: number; mesh: Mesh | null; waterMesh: Mesh | null }
function lodProbe() {
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
  vi.stubGlobal('Worker', FakeWorker);
  const manager = new TerrainChunkManager(new Scene(), new ShaderMaterial(), null, null,
    { type: 'init', seedHex: '0123456789abcdef', physical: {} as Characterization }, 6371);
  const state = manager as unknown as {
    wanted: Array<{ record: TileProbe }>;
    chunks: Map<string, TileProbe>;
  };
  const settle = (eye: Vector3, floor = 0) => {
    for (let frame = 0; frame < 30; frame++) {
      manager.update(eye, 0, floor);
      if (!state.wanted.length) return;
      for (const { record } of state.wanted) if (!record.mesh) {
        record.mesh = new Mesh();
        record.waterMesh = new Mesh();
      }
    }
    throw new Error('Terrain traversal did not settle');
  };
  const drawn = () => [...state.chunks.values()].filter(tile => tile.mesh?.visible);
  return { manager, state, settle, drawn };
}

it('draws coarse orbital tiles, retains cached detail, and still refines to walking scale', () => {
  const { manager, state, settle, drawn } = lodProbe();
  try {
    const orbit = new Vector3(0, 0, 4 * 6371);
    settle(orbit, 3);
    const forced = drawn().length;
    const cached = state.chunks.size;
    settle(orbit);
    expect(drawn().length).toBeLessThan(forced / 4);
    expect(Math.max(...drawn().map(tile => tile.level))).toBeLessThan(3);
    expect(state.chunks.size).toBe(cached);
    settle(new Vector3(0, 0, 6371.002));
    expect(Math.max(...drawn().map(tile => tile.level))).toBe(22);
    manager.update(orbit);
    expect(manager.outstanding).toBe(0);
    expect(Math.max(...drawn().map(tile => tile.level))).toBeLessThan(3);
  } finally { manager.dispose(); }
});

it('keeps the parent terrain and water visible until all four children arrive', () => {
  const { manager, state, settle } = lodProbe();
  try {
    settle(new Vector3(0, 0, 20 * 6371));
    const root = state.chunks.get('4:0:0:0')!;
    const closer = new Vector3(0, 0, 4 * 6371);
    manager.update(closer);
    const children = ['4:1:0:0', '4:1:1:0', '4:1:0:1', '4:1:1:1'].map(key => state.chunks.get(key)!);
    for (const child of children.slice(0, 3)) { child.mesh = new Mesh(); child.waterMesh = new Mesh(); }
    manager.update(closer);
    expect(root.mesh?.visible).toBe(true);
    expect(root.waterMesh?.visible).toBe(true);
    expect(children.slice(0, 3).every(child => !child.mesh?.visible)).toBe(true);
    children[3].mesh = new Mesh(); children[3].waterMesh = new Mesh();
    manager.update(closer);
    expect(root.mesh?.visible).toBe(false);
    expect(root.waterMesh?.visible).toBe(false);
    expect(children.every(child => child.mesh?.visible && child.waterMesh?.visible)).toBe(true);
  } finally { manager.dispose(); }
});

it('bounds unused tiles during rapid ground travel and preserves immediate retreat coverage', () => {
  const { manager, state, settle, drawn } = lodProbe();
  try {
    const orbit = new Vector3(0, 0, 4 * 6371);
    settle(orbit);
    // 400 m of travel at walking clearance crosses many level-22 tiles
    // before a 600-frame age grace period can expire.
    for (let meters = 0; meters <= 400; meters += 20) {
      settle(new Vector3(meters / 1000, 0, 6371.002).normalize().multiplyScalar(6371.002));
      expect(manager.cachedChunks).toBeLessThanOrEqual(2000);
      expect(drawn().length).toBeGreaterThan(0);
    }
    manager.update(orbit);
    expect(manager.outstanding).toBe(0);
    expect(drawn().every(tile => tile.waterMesh?.visible)).toBe(true);
    expect(state.chunks.size).toBeLessThanOrEqual(2000);
  } finally { manager.dispose(); }
});
