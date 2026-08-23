import { faceUvToDir } from './cubeSphere';
import type { SurfaceField } from './field';

export interface ChunkMesh {
  /** Chunk anchor on the datum sphere, km, planet-local. */
  centerKm: [number, number, number];
  /** Vertex positions relative to the anchor, km (grid then skirt ring). */
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /**
   * Sea surface on the same grid points projected to the sea-level
   * radius — resolution-matched to the terrain, so the two surfaces
   * cross only at real coastlines. Null when the tile is fully dry.
   */
  waterPositions: Float32Array | null;
  waterNormals: Float32Array | null;
}

/**
 * One quadtree tile: (res+1)² displaced grid vertices plus a skirt ring
 * dropped toward the planet center to hide cracks between LOD levels.
 * The grid samples one extra border vertex on every side so normals get
 * full neighborhoods — adjacent chunks light identically at their shared
 * edge. Positions are anchor-relative so float32 stays precise at ground
 * level. Pure — runs identically on the main thread or in a worker.
 */
export function buildChunkMesh(
  field: SurfaceField,
  face: number,
  level: number,
  x: number,
  y: number,
  res: number,
): ChunkMesh {
  const radiusKm = field.params.radiusM / 1000;
  const tiles = 2 ** level;
  const ext = res + 3;
  const gridCount = (res + 1) * (res + 1);
  const skirtCount = 4 * (res + 1);
  const positions = new Float32Array((gridCount + skirtCount) * 3);
  const normals = new Float32Array((gridCount + skirtCount) * 3);
  const colors = new Float32Array((gridCount + skirtCount) * 3);

  const centerDir = faceUvToDir(face, (x + 0.5) / tiles, (y + 0.5) / tiles);
  const centerKm: [number, number, number] = [
    centerDir.x * radiusKm,
    centerDir.y * radiusKm,
    centerDir.z * radiusKm,
  ];

  // Vertex angular spacing: detail below its Nyquist limit is skipped.
  const lodAngularRad = Math.PI / 2 / tiles / res;

  // Extended grid (border row/column on every side) for seamless normals.
  const extPositions = new Float64Array(ext * ext * 3);
  const extNormals = new Float64Array(ext * ext * 3);
  const heights = new Float64Array(ext * ext);
  const dirs = new Float64Array(ext * ext * 3);
  let minHeight = Infinity;
  for (let j = 0; j < ext; j++) {
    for (let i = 0; i < ext; i++) {
      const index = j * ext + i;
      const dir = faceUvToDir(face, (x + (i - 1) / res) / tiles, (y + (j - 1) / res) / tiles);
      const h = field.heightAt(dir, lodAngularRad);
      heights[index] = h;
      if (h < minHeight) minHeight = h;
      dirs[index * 3] = dir.x;
      dirs[index * 3 + 1] = dir.y;
      dirs[index * 3 + 2] = dir.z;
      const rKm = radiusKm + h / 1000;
      extPositions[index * 3] = dir.x * rKm - centerKm[0];
      extPositions[index * 3 + 1] = dir.y * rKm - centerKm[1];
      extPositions[index * 3 + 2] = dir.z * rKm - centerKm[2];
    }
  }

  accumulateNormals(extPositions, extNormals, ext);

  for (let j = 0; j <= res; j++) {
    for (let i = 0; i <= res; i++) {
      const outIndex = j * (res + 1) + i;
      const extIndex = (j + 1) * ext + (i + 1);
      for (let c = 0; c < 3; c++) {
        positions[outIndex * 3 + c] = extPositions[extIndex * 3 + c];
        normals[outIndex * 3 + c] = extNormals[extIndex * 3 + c];
      }
      const dir = {
        x: dirs[extIndex * 3],
        y: dirs[extIndex * 3 + 1],
        z: dirs[extIndex * 3 + 2],
      };
      const slopeCos =
        extNormals[extIndex * 3] * dir.x +
        extNormals[extIndex * 3 + 1] * dir.y +
        extNormals[extIndex * 3 + 2] * dir.z;
      const [r, g, b] = field.colorAt(dir, heights[extIndex], slopeCos, lodAngularRad);
      colors[outIndex * 3] = r;
      colors[outIndex * 3 + 1] = g;
      colors[outIndex * 3 + 2] = b;
    }
  }

  buildSkirt(positions, normals, colors, res, radiusKm / tiles, centerKm, radiusKm);

  let waterPositions: Float32Array | null = null;
  let waterNormals: Float32Array | null = null;
  if (field.seaLevelM > -1e8 && minHeight < field.seaLevelM + 5) {
    const seaKm = radiusKm + field.seaLevelM / 1000;
    waterPositions = new Float32Array((gridCount + skirtCount) * 3);
    waterNormals = new Float32Array((gridCount + skirtCount) * 3);
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        const outIndex = j * (res + 1) + i;
        const extIndex = (j + 1) * ext + (i + 1);
        for (let c = 0; c < 3; c++) {
          const d = dirs[extIndex * 3 + c];
          waterPositions[outIndex * 3 + c] = d * seaKm - centerKm[c];
          waterNormals[outIndex * 3 + c] = d;
        }
      }
    }
    buildSkirt(waterPositions, waterNormals, waterNormals, res, radiusKm / tiles, centerKm, radiusKm);
  }

  return { centerKm, positions, normals, colors, waterPositions, waterNormals };
}

/** Area-weighted triangle normals accumulated over the extended grid. */
function accumulateNormals(positions: Float64Array, normals: Float64Array, ext: number): void {
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (let j = 0; j < ext - 1; j++) {
    for (let i = 0; i < ext - 1; i++) {
      const i00 = (j * ext + i) * 3;
      const i10 = (j * ext + i + 1) * 3;
      const i01 = ((j + 1) * ext + i) * 3;
      for (let k = 0; k < 3; k++) {
        a[k] = positions[i10 + k] - positions[i00 + k];
        b[k] = positions[i01 + k] - positions[i00 + k];
      }
      const nx = a[1] * b[2] - a[2] * b[1];
      const ny = a[2] * b[0] - a[0] * b[2];
      const nz = a[0] * b[1] - a[1] * b[0];
      for (const corner of [i00, i10, i01, ((j + 1) * ext + i + 1) * 3]) {
        normals[corner] += nx;
        normals[corner + 1] += ny;
        normals[corner + 2] += nz;
      }
    }
  }
  for (let v = 0; v < ext * ext; v++) {
    const length = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    normals[v * 3] /= length;
    normals[v * 3 + 1] /= length;
    normals[v * 3 + 2] /= length;
  }
}

/** Edge vertices duplicated and dropped radially to mask LOD cracks. */
function buildSkirt(
  positions: Float32Array,
  normals: Float32Array,
  colors: Float32Array,
  res: number,
  chunkSizeKm: number,
  centerKm: [number, number, number],
  radiusKm: number,
): void {
  const stride = res + 1;
  const gridCount = stride * stride;
  const depthKm = Math.max(chunkSizeKm * 0.08, 0.05);
  const edgeIndex = (side: number, k: number): number => {
    switch (side) {
      case 0: return k;
      case 1: return res * stride + k;
      case 2: return k * stride;
      default: return k * stride + res;
    }
  };
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k <= res; k++) {
      const source = edgeIndex(side, k) * 3;
      const target = (gridCount + side * stride + k) * 3;
      // Drop along the planet radial through this vertex.
      const wx = positions[source] + centerKm[0];
      const wy = positions[source + 1] + centerKm[1];
      const wz = positions[source + 2] + centerKm[2];
      const inv = depthKm / (Math.hypot(wx, wy, wz) || radiusKm);
      positions[target] = positions[source] - wx * inv;
      positions[target + 1] = positions[source + 1] - wy * inv;
      positions[target + 2] = positions[source + 2] - wz * inv;
      for (let c = 0; c < 3; c++) {
        normals[target + c] = normals[source + c];
        colors[target + c] = colors[source + c];
      }
    }
  }
}
