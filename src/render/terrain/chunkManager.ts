import { BufferAttribute, BufferGeometry, Mesh, Scene, ShaderMaterial, Vector3 } from 'three';
import type { Characterization } from '../../universe/planet/types';
import { chunkAngularSize, faceUvToDir } from '../../universe/surface/cubeSphere';
import type { TerrainRequest, TerrainResponse } from '../../workers/protocol';
import { buildChunkIndices } from './terrainMaterial';

const RES = 32;
const MAX_LEVEL = 15;
const SPLIT_RATIO = 1.3;
const MAX_CHUNKS = 420;
const MAX_IN_FLIGHT = 10;

interface ChunkRecord {
  key: string;
  centerKm: [number, number, number] | null;
  mesh: Mesh | null;
  lastDrawn: number;
}

/**
 * Cube-sphere quadtree streamer: traverses each face by screen-space
 * error against the camera's planet-local position, requests missing
 * tiles from a worker pool, draws parents until all four children are
 * ready, and culls beyond the horizon. Chunk meshes are anchor-relative;
 * this manager rebases them against the camera each frame, so rendering
 * stays float32-clean from orbit to the ground.
 */
export class TerrainChunkManager {
  private readonly workers: Worker[] = [];
  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly pending = new Map<number, string>();
  private readonly indexAttribute = new BufferAttribute(buildChunkIndices(RES), 1);
  private readonly radiusKm: number;
  private nextRequestId = 1;
  private nextWorker = 0;
  private frame = 0;

  constructor(
    private readonly scene: Scene,
    private readonly material: ShaderMaterial,
    seedHex: string,
    physical: Characterization,
  ) {
    this.radiusKm = (physical.bulk.radiusEarth * 6371000) / 1000;
    const workerCount = 2;
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL('../../workers/terrainWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<TerrainResponse>) => this.receive(event.data);
      const init: TerrainRequest = { type: 'init', seedHex, physical };
      worker.postMessage(init);
      this.workers.push(worker);
    }
  }

  /** cameraKm is the camera's planet-local position, used for LOD and culling. */
  update(cameraKm: Vector3): void {
    this.frame++;
    for (const record of this.chunks.values()) {
      if (record.mesh) record.mesh.visible = false;
    }

    const cameraDistance = cameraKm.length();
    const cameraDir = cameraKm.clone().normalize();
    const horizonAngle = Math.acos(
      Math.min(1, Math.max(-1, this.radiusKm / Math.max(cameraDistance, this.radiusKm))),
    );

    for (let face = 0; face < 6; face++) {
      this.visit(face, 0, 0, 0, cameraKm, cameraDir, horizonAngle);
    }
    this.evict();
  }

  private visit(
    face: number,
    level: number,
    x: number,
    y: number,
    cameraKm: Vector3,
    cameraDir: Vector3,
    horizonAngle: number,
  ): void {
    const tiles = 2 ** level;
    const dir = faceUvToDir(face, (x + 0.5) / tiles, (y + 0.5) / tiles);
    const angular = chunkAngularSize(level);

    const angleToCamera = Math.acos(
      Math.min(1, Math.max(-1, dir.x * cameraDir.x + dir.y * cameraDir.y + dir.z * cameraDir.z)),
    );
    if (angleToCamera > horizonAngle + angular * 1.5 + 0.15) return;

    const sizeKm = angular * this.radiusKm;
    const dx = dir.x * this.radiusKm - cameraKm.x;
    const dy = dir.y * this.radiusKm - cameraKm.y;
    const dz = dir.z * this.radiusKm - cameraKm.z;
    const distanceKm = Math.max(Math.hypot(dx, dy, dz), 0.02);

    if (sizeKm / distanceKm > SPLIT_RATIO && level < MAX_LEVEL) {
      const children: ChunkRecord[] = [];
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          children.push(this.ensure(face, level + 1, x * 2 + cx, y * 2 + cy));
        }
      }
      if (children.every((child) => child.mesh)) {
        for (let cy = 0; cy < 2; cy++) {
          for (let cx = 0; cx < 2; cx++) {
            this.visit(face, level + 1, x * 2 + cx, y * 2 + cy, cameraKm, cameraDir, horizonAngle);
          }
        }
        return;
      }
    }
    this.draw(this.ensure(face, level, x, y));
  }

  private draw(record: ChunkRecord): void {
    record.lastDrawn = this.frame;
    if (record.mesh) record.mesh.visible = true;
  }

  private ensure(face: number, level: number, x: number, y: number): ChunkRecord {
    const key = `${face}:${level}:${x}:${y}`;
    let record = this.chunks.get(key);
    if (record) {
      record.lastDrawn = this.frame;
      return record;
    }
    record = { key, centerKm: null, mesh: null, lastDrawn: this.frame };
    this.chunks.set(key, record);
    if (this.pending.size < MAX_IN_FLIGHT) {
      const id = this.nextRequestId++;
      this.pending.set(id, key);
      const request: TerrainRequest = { type: 'chunk', id, face, level, x, y, res: RES };
      this.workers[this.nextWorker].postMessage(request);
      this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    } else {
      // Over budget: forget so a later frame can retry.
      this.chunks.delete(key);
    }
    return record;
  }

  private receive(response: TerrainResponse): void {
    const key = this.pending.get(response.id);
    this.pending.delete(response.id);
    if (!key) return;
    const record = this.chunks.get(key);
    if (!record) return;

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(response.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(response.normals, 3));
    geometry.setAttribute('color', new BufferAttribute(response.colors, 3));
    geometry.setIndex(this.indexAttribute);
    geometry.computeBoundingSphere();

    const mesh = new Mesh(geometry, this.material);
    mesh.visible = false;
    mesh.position.set(...response.centerKm);
    record.centerKm = response.centerKm;
    record.mesh = mesh;
    this.scene.add(mesh);
  }

  private evict(): void {
    if (this.chunks.size <= MAX_CHUNKS) return;
    const records = [...this.chunks.values()].sort((a, b) => a.lastDrawn - b.lastDrawn);
    const excess = this.chunks.size - MAX_CHUNKS;
    for (let i = 0; i < excess; i++) {
      const record = records[i];
      if (record.lastDrawn >= this.frame - 60) break;
      if (record.mesh) {
        this.scene.remove(record.mesh);
        record.mesh.geometry.dispose();
      }
      this.chunks.delete(record.key);
    }
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    for (const record of this.chunks.values()) {
      if (record.mesh) {
        this.scene.remove(record.mesh);
        record.mesh.geometry.dispose();
      }
    }
    this.chunks.clear();
  }
}
