import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { chunkAngularSize, faceUvToDir } from '../../universe/surface/cubeSphere';
import { SCATTER_STRIDE } from '../../universe/surface/scatter';
import type { TerrainInit, TerrainRequest, TerrainResponse } from '../../workers/protocol';
import { createRockGeometry, createShrubGeometry } from './scatterObjects';
import { buildChunkIndices } from './terrainMaterial';

/** Vertices per tile edge: the detail-resolution knob. 64 puts the
 *  walking floor at ~4 cm spacing and sharpens every LOD ring. */
const RES = 64;
/** Level 22 tiles are ~2.7 m across at Earth radius. */
const MAX_LEVEL = 22;
/** Never show tiles coarser than this within the horizon: they are pinned,
 *  so the whole-planet base layer builds once per visit. */
const MIN_LEVEL = 3;
/** Split when tile size exceeds this fraction of its distance. The
 *  terrain material's geomorph is calibrated against the same ratio. */
export const SPLIT_RATIO = 0.45;
/** Denser tiles cost more each: the cap keeps worst-case GPU memory
 *  in the same envelope it had at the old resolution. */
const MAX_CHUNKS = 2000;
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
  scatterMeshes: InstancedMesh[];
  /** Mean instance position: the surface can sit far off the datum anchor. */
  scatterCenterKm: [number, number, number] | null;
  requested: boolean;
  lastDrawn: number;
}

interface WantedChunk {
  record: ChunkRecord;
  /** Camera distance, discounted for tiles ahead of the motion. */
  priorityKm: number;
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
  private readonly rockGeometry = createRockGeometry();
  private readonly shrubGeometry = createShrubGeometry();
  private readonly radiusKm: number;
  private nextRequestId = 1;
  private nextWorker = 0;
  private frame = 0;

  constructor(
    private readonly scene: Scene,
    private readonly material: ShaderMaterial,
    private readonly oceanMaterial: ShaderMaterial | null,
    private readonly scatterMaterial: ShaderMaterial | null,
    init: TerrainInit,
    radiusKm: number,
    /** Per-species tree geometries for scatter kinds ≥ 2; owned here. */
    private readonly treeGeometries: BufferGeometry[] = [],
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

  /** Terrain height under the camera, km above the datum: LOD distances
   *  measure to the local ground sphere, not the datum — on a world
   *  whose land rides hundreds of meters above datum, datum distances
   *  stall the quadtree exactly that far short of the walker's feet. */
  private groundOffsetKm = 0;
  /** Unit camera motion since last frame; zero when parked. */
  private readonly motionDir = new Vector3();
  private readonly lastCameraKm = new Vector3(Infinity, 0, 0);

  /** cameraKm is the camera's planet-local position, used for LOD and culling. */
  update(cameraKm: Vector3, groundKm = 0): void {
    this.frame++;
    this.groundOffsetKm = groundKm;
    if (Number.isFinite(this.lastCameraKm.x)) {
      this.motionDir.copy(cameraKm).sub(this.lastCameraKm);
      const speed = this.motionDir.length();
      if (speed > 1e-9) this.motionDir.divideScalar(speed);
      else this.motionDir.set(0, 0, 0);
    }
    this.lastCameraKm.copy(cameraKm);
    for (const record of this.chunks.values()) {
      if (record.mesh) record.mesh.visible = false;
      if (record.waterMesh) record.waterMesh.visible = false;
      for (const scatter of record.scatterMeshes) scatter.visible = false;
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

    // Scatter shows by proximity, not by which LOD tile is drawn: its
    // host tile is often replaced by finer children exactly when the
    // camera is close enough to see the instances.
    for (const record of this.chunks.values()) {
      if (record.scatterMeshes.length === 0 || !record.scatterCenterKm) continue;
      const sizeKm = chunkAngularSize(record.level) * this.radiusKm;
      const dx = record.scatterCenterKm[0] - cameraKm.x;
      const dy = record.scatterCenterKm[1] - cameraKm.y;
      const dz = record.scatterCenterKm[2] - cameraKm.z;
      const visible = dx * dx + dy * dy + dz * dz < (3.5 * sizeKm) ** 2;
      for (const scatter of record.scatterMeshes) scatter.visible = visible;
      if (visible) record.lastDrawn = this.frame;
    }

    this.dispatch();
    this.evict();
  }

  /** Send the nearest-needed tiles to the workers first, up to the budget. */
  private dispatch(): void {
    this.wanted.sort((a, b) => a.priorityKm - b.priorityKm);
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
    const sampleKm = this.radiusKm + this.groundOffsetKm;
    const dx = dir.x * sampleKm - cameraKm.x;
    const dy = dir.y * sampleKm - cameraKm.y;
    const dz = dir.z * sampleKm - cameraKm.z;
    const distanceKm = Math.max(Math.hypot(dx, dy, dz), 0.005);
    // Tiles ahead of the camera's motion build first: a running walker
    // (or a descending ride) streams into ground it hasn't reached yet.
    const ahead = Math.max(
      0,
      (dx * this.motionDir.x + dy * this.motionDir.y + dz * this.motionDir.z) / distanceKm,
    );
    const priorityKm = distanceKm * (1 - 0.4 * ahead);

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
        if (!child.mesh) this.wanted.push({ record: child, priorityKm });
      }
    }

    const record = this.ensure(face, level, x, y);
    record.lastDrawn = this.frame;
    if (record.mesh) {
      record.mesh.visible = true;
      if (record.waterMesh) record.waterMesh.visible = true;
      return;
    }
    this.wanted.push({ record, priorityKm });
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
      scatterMeshes: [],
      scatterCenterKm: null,
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
    // The pinned base has no drawn parent to morph from: beyond its
    // swap-in distance (all of orbit) it would render one LOD coarser
    // than the pre-geomorph planet. Zeroed deltas keep orbit exact.
    if (record.level <= PINNED_LEVEL) {
      for (let i = 0; i < response.morph.length; i += 2) response.morph[i] = 0;
    }
    geometry.setAttribute('aMorph', new BufferAttribute(response.morph, 2));
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

    if (response.scatter && this.scatterMaterial) {
      record.scatterMeshes = this.buildScatter(response.scatter, response.centerKm);
      const data = response.scatter;
      const count = data.length / SCATTER_STRIDE;
      const mean: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < data.length; i += SCATTER_STRIDE) {
        mean[0] += data[i];
        mean[1] += data[i + 1];
        mean[2] += data[i + 2];
      }
      record.scatterCenterKm = [
        response.centerKm[0] + mean[0] / count,
        response.centerKm[1] + mean[1] / count,
        response.centerKm[2] + mean[2] / count,
      ];
    }
  }

  /** One instanced draw per scatter kind per tile: boulders, ground
   *  cover, and each tree species present. */
  private buildScatter(
    data: Float32Array,
    centerKm: [number, number, number],
  ): InstancedMesh[] {
    const anchor = new Vector3(...centerKm);
    const matrix = new Matrix4();
    const align = new Quaternion();
    const spin = new Quaternion();
    const up = new Vector3();
    const position = new Vector3();
    const scale = new Vector3();
    const color = new Color();
    const yAxis = new Vector3(0, 1, 0);

    const meshes: InstancedMesh[] = [];
    for (let kind = 0; kind < 2 + this.treeGeometries.length; kind++) {
      const geometry =
        kind === 0
          ? this.rockGeometry
          : kind === 1
            ? this.shrubGeometry
            : this.treeGeometries[kind - 2];
      if (!geometry) continue;
      const rows: number[] = [];
      for (let i = 0; i < data.length; i += SCATTER_STRIDE) {
        if (Math.round(data[i + 5]) === kind) rows.push(i);
      }
      if (rows.length === 0) continue;
      const mesh = new InstancedMesh(geometry, this.scatterMaterial!, rows.length);
      rows.forEach((i, instance) => {
        position.set(data[i], data[i + 1], data[i + 2]);
        up.copy(position).add(anchor).normalize();
        align.setFromUnitVectors(yAxis, up);
        spin.setFromAxisAngle(yAxis, data[i + 4]);
        align.multiply(spin);
        scale.setScalar(data[i + 3]);
        matrix.compose(position, align, scale);
        mesh.setMatrixAt(instance, matrix);
        mesh.setColorAt(instance, color.setRGB(data[i + 6], data[i + 7], data[i + 8]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.position.copy(anchor);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
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
    for (const scatter of record.scatterMeshes) {
      this.scene.remove(scatter);
      scatter.dispose();
    }
    record.scatterMeshes = [];
    this.chunks.delete(record.key);
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    for (const record of [...this.chunks.values()]) this.remove(record);
    this.chunks.clear();
    this.rockGeometry.dispose();
    this.shrubGeometry.dispose();
    for (const geometry of this.treeGeometries) geometry.dispose();
  }
}
