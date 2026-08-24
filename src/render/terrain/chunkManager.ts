import { BufferAttribute, BufferGeometry, Mesh, Scene, ShaderMaterial, Vector3 } from 'three';
import { chunkAngularSize, faceUvToDir } from '../../universe/surface/cubeSphere';
import type { TerrainInit, TerrainRequest, TerrainResponse } from '../../workers/protocol';
import { buildChunkIndices } from './terrainMaterial';

const RES = 48;
const MAX_LEVEL = 17;
/** Never show tiles coarser than this within the horizon: they are pinned,
 *  so the whole-planet base layer builds once per visit. */
const MIN_LEVEL = 3;
const SPLIT_RATIO = 0.45;
const MAX_CHUNKS = 1400;
const MAX_IN_FLIGHT = 24;
/** Levels this coarse are never evicted: they cover zoom-out instantly. */
const PINNED_LEVEL = 3;
const EVICT_AGE_FRAMES = 600;

interface ChunkRecord {
  key: string;
  face: number;
  level: number;
  x: number;
  y: number;
  centerKm: [number, number, number] | null;
  mesh: Mesh | null;
  waterMesh: Mesh | null;
  requested: boolean;
  lastDrawn: number;
}

interface WantedChunk {
  record: ChunkRecord;
  distanceKm: number;
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
  private wanted: WantedChunk[] = [];
  private readonly indexAttribute = new BufferAttribute(buildChunkIndices(RES), 1);
  private readonly radiusKm: number;
  private nextRequestId = 1;
  private nextWorker = 0;
  private frame = 0;

  constructor(
    private readonly scene: Scene,
    private readonly material: ShaderMaterial,
    private readonly oceanMaterial: ShaderMaterial | null,
    init: TerrainInit,
    radiusKm: number,
  ) {
    this.radiusKm = radiusKm;
    const workerCount = Math.min(5, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL('../../workers/terrainWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<TerrainResponse>) => this.receive(event.data);
      worker.postMessage(init);
      this.workers.push(worker);
    }
  }

  /** cameraKm is the camera's planet-local position, used for LOD and culling. */
  update(cameraKm: Vector3): void {
    this.frame++;
    for (const record of this.chunks.values()) {
      if (record.mesh) record.mesh.visible = false;
      if (record.waterMesh) record.waterMesh.visible = false;
    }

    const cameraDistance = cameraKm.length();
    const cameraDir = cameraKm.clone().normalize();
    const horizonAngle = Math.acos(
      Math.min(1, Math.max(-1, this.radiusKm / Math.max(cameraDistance, this.radiusKm))),
    );

    this.wanted = [];
    for (let face = 0; face < 6; face++) {
      this.visit(face, 0, 0, 0, cameraKm, cameraDir, horizonAngle);
    }
    this.dispatch();
    this.evict();
  }

  /** Send the nearest-needed tiles to the workers first, up to the budget. */
  private dispatch(): void {
    this.wanted.sort((a, b) => a.distanceKm - b.distanceKm);
    for (const { record } of this.wanted) {
      if (this.pending.size >= MAX_IN_FLIGHT) break;
      if (record.requested || record.mesh) continue;
      record.requested = true;
      const id = this.nextRequestId++;
      this.pending.set(id, record.key);
      const request: TerrainRequest = {
        type: 'chunk',
        id,
        face: record.face,
        level: record.level,
        x: record.x,
        y: record.y,
        res: RES,
      };
      this.workers[this.nextWorker].postMessage(request);
      this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    }
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

    if ((sizeKm / distanceKm > SPLIT_RATIO || level < MIN_LEVEL) && level < MAX_LEVEL) {
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
      for (const child of children) {
        if (!child.mesh) this.wanted.push({ record: child, distanceKm });
      }
    }

    const record = this.ensure(face, level, x, y);
    record.lastDrawn = this.frame;
    if (record.mesh) {
      record.mesh.visible = true;
      if (record.waterMesh) record.waterMesh.visible = true;
      return;
    }
    this.wanted.push({ record, distanceKm });
    // While this tile (re)builds, show any cached finer children instead of a hole.
    if (level < MAX_LEVEL) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          const child = this.chunks.get(`${face}:${level + 1}:${x * 2 + cx}:${y * 2 + cy}`);
          if (child?.mesh) {
            child.lastDrawn = this.frame;
            child.mesh.visible = true;
            if (child.waterMesh) child.waterMesh.visible = true;
          }
        }
      }
    }
  }

  private ensure(face: number, level: number, x: number, y: number): ChunkRecord {
    const key = `${face}:${level}:${x}:${y}`;
    let record = this.chunks.get(key);
    if (record) {
      record.lastDrawn = this.frame;
      return record;
    }
    record = {
      key,
      face,
      level,
      x,
      y,
      centerKm: null,
      mesh: null,
      waterMesh: null,
      requested: false,
      lastDrawn: this.frame,
    };
    this.chunks.set(key, record);
    return record;
  }

  private receive(response: TerrainResponse): void {
    const key = this.pending.get(response.id);
    this.pending.delete(response.id);
    if (!key) return;
    const record = this.chunks.get(key);
    if (!record) return;
    record.requested = false;

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

    if (response.waterPositions && response.waterNormals && this.oceanMaterial) {
      const waterGeometry = new BufferGeometry();
      waterGeometry.setAttribute('position', new BufferAttribute(response.waterPositions, 3));
      waterGeometry.setAttribute('normal', new BufferAttribute(response.waterNormals, 3));
      waterGeometry.setIndex(this.indexAttribute);
      waterGeometry.computeBoundingSphere();
      const waterMesh = new Mesh(waterGeometry, this.oceanMaterial);
      waterMesh.visible = false;
      waterMesh.position.set(...response.centerKm);
      record.waterMesh = waterMesh;
      this.scene.add(waterMesh);
    }
  }

  private evict(): void {
    if (this.chunks.size <= MAX_CHUNKS) return;
    const evictable = [...this.chunks.values()]
      .filter((record) => record.level > PINNED_LEVEL)
      .sort((a, b) => a.lastDrawn - b.lastDrawn);
    let excess = this.chunks.size - MAX_CHUNKS;
    for (const record of evictable) {
      if (excess <= 0 || record.lastDrawn >= this.frame - EVICT_AGE_FRAMES) break;
      this.remove(record);
      excess--;
    }
  }

  private remove(record: ChunkRecord): void {
    if (record.mesh) {
      this.scene.remove(record.mesh);
      record.mesh.geometry.dispose();
    }
    if (record.waterMesh) {
      this.scene.remove(record.waterMesh);
      record.waterMesh.geometry.dispose();
    }
    this.chunks.delete(record.key);
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    for (const record of [...this.chunks.values()]) this.remove(record);
    this.chunks.clear();
  }
}
