import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, ShaderMaterial, Vector3 } from 'three';
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
