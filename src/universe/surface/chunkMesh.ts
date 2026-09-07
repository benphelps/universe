import { faceUvToDir } from './cubeSphere';
import type { SurfaceField } from './field';
import { waterIceFraction } from './waterIce';

export interface ChunkMesh {
  /** Chunk anchor on the datum sphere, km, planet-local. */
  centerKm: [number, number, number];
  /** Vertex positions relative to the anchor, km (grid then skirt ring). */
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /**
   * Per-vertex (xyz offset from the actual parent triangle in km, tile
   * edge in km). Removing the offset reproduces the parent mesh,
   * including spherical curvature between its vertices.
   */
  morph: Float32Array;
  /**
   * Sea surface on the same grid points projected to the sea-level
   * radius — resolution-matched to the terrain, so the two surfaces
   * cross only at real coastlines. Null when the tile is fully dry.
   */
  waterPositions: Float32Array | null;
  waterNormals: Float32Array | null;
  /** Fluid delta to its own parent triangles, including spherical sag.
   * Terrain and fluid use the same per-vertex transition weight. */
  waterMorph: Float32Array | null;
  /** Normalized bytes: fine and parent-triangle ice fraction. Only water
   * worlds allocate these; phase follows the same transition as geometry. */
  waterIce: Uint8Array | null;
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
  const morph = new Float32Array((gridCount + skirtCount) * 4);
  const tileSizeKm = ((Math.PI / 2) * radiusKm) / tiles;

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

  // Parent grid vertices coincide with every other child vertex. Cache
  // them once, then interpolate the same b-c diagonal as the index buffer.
  const parentStride = res / 2 + 1;
  const parentPositions = new Float64Array(parentStride * parentStride * 3);
  const parentHeights = new Float64Array(parentStride * parentStride);
  for (let j = 0; j < parentStride; j++) {
    for (let i = 0; i < parentStride; i++) {
      const dir = faceUvToDir(face, (x + 2 * i / res) / tiles, (y + 2 * j / res) / tiles);
      const h = field.heightAt(dir, lodAngularRad * 2);
      parentHeights[j * parentStride + i] = h;
      const r = radiusKm + h / 1000;
      const k = (j * parentStride + i) * 3;
      parentPositions[k] = dir.x * r - centerKm[0];
      parentPositions[k + 1] = dir.y * r - centerKm[1];
      parentPositions[k + 2] = dir.z * r - centerKm[2];
    }
  }

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
      morph[outIndex * 4 + 3] = tileSizeKm;
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

  writeParentMorph(positions, parentPositions, res, morph, 4);
  buildSkirt(positions, normals, colors, res, radiusKm / tiles, centerKm, radiusKm);
  // Skirt vertices morph with the edge vertex they duplicate.
  copySkirtMorph(morph, res, 4);

  // Water rides its local surface: the sea, lake fill levels, and river
  // stages on their graded beds. Each vertex takes its own level; dry
  // vertices tuck 25 m under their terrain so mixed tiles blend out.
  let waterPositions: Float32Array | null = null;
  let waterNormals: Float32Array | null = null;
  let waterMorph: Float32Array | null = null;
  let waterIce: Uint8Array | null = null;
  const maybeWet = field.drainage
    ? true
    : field.seaLevelM > -1e8 && minHeight < field.seaLevelM + 5;
  if (maybeWet) {
    const levels = new Float64Array(gridCount);
    let wet = false;
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        const outIndex = j * (res + 1) + i;
        const extIndex = (j + 1) * ext + (i + 1);
        const dir = {
          x: dirs[extIndex * 3],
          y: dirs[extIndex * 3 + 1],
          z: dirs[extIndex * 3 + 2],
        };
        const level = field.waterLevelAt(dir, lodAngularRad, heights[extIndex]);
        levels[outIndex] = level;
        if (level > heights[extIndex] - 5) wet = true;
      }
    }
    if (wet) {
      waterPositions = new Float32Array((gridCount + skirtCount) * 3);
      waterNormals = new Float32Array((gridCount + skirtCount) * 3);
      waterMorph = new Float32Array((gridCount + skirtCount) * 3);
      if (field.params.surfaceIce && !(field.params.magmaCoverage > 0)) waterIce = new Uint8Array((gridCount + skirtCount) * 2);
      for (let j = 0; j <= res; j++) {
        for (let i = 0; i <= res; i++) {
          const outIndex = j * (res + 1) + i;
          const extIndex = (j + 1) * ext + (i + 1);
          const level =
            levels[outIndex] > -1e8 ? levels[outIndex] : heights[extIndex] - 25;
          const rKm = radiusKm + level / 1000;
          if (waterIce) {
            const dir = { x: dirs[extIndex * 3], y: dirs[extIndex * 3 + 1], z: dirs[extIndex * 3 + 2] };
            waterIce[outIndex * 2] = waterIce[outIndex * 2 + 1] = Math.round(255 * waterIceFraction(field.params, dir, level));
          }
          for (let c = 0; c < 3; c++) {
            const d = dirs[extIndex * 3 + c];
            waterPositions[outIndex * 3 + c] = d * rKm - centerKm[c];
            waterNormals[outIndex * 3 + c] = d;
          }
        }
      }
      if (level > 0) {
        const parentWater = new Float64Array(parentPositions.length);
        const parentIce = waterIce ? new Float64Array(parentStride * parentStride) : null;
        for (let j = 0; j < parentStride; j++) {
          for (let i = 0; i < parentStride; i++) {
            const dir = faceUvToDir(face, (x + 2 * i / res) / tiles, (y + 2 * j / res) / tiles);
            const k = (j * parentStride + i) * 3;
            const levelM = field.waterLevelAt(dir, lodAngularRad * 2, parentHeights[k / 3]);
            // Dry parent vertices have the same buried fluid fallback as
            // an independently built parent tile. Never import the ground's
            // relief delta into an otherwise level sea.
            const radius = levelM > -1e8 ? radiusKm + levelM / 1000 :
              Math.hypot(parentPositions[k] + centerKm[0], parentPositions[k + 1] + centerKm[1],
                parentPositions[k + 2] + centerKm[2]) - 0.025;
            parentWater[k] = dir.x * radius - centerKm[0];
            parentWater[k + 1] = dir.y * radius - centerKm[1];
            parentWater[k + 2] = dir.z * radius - centerKm[2];
            if (parentIce) parentIce[k / 3] = Math.round(255 * waterIceFraction(field.params, dir, (radius - radiusKm) * 1000));
          }
        }
        writeParentMorph(waterPositions, parentWater, res, waterMorph, 3);
        copySkirtMorph(waterMorph, res, 3);
        if (waterIce && parentIce) {
          for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
            const pi = Math.min(Math.floor(i / 2), parentStride - 2), pj = Math.min(Math.floor(j / 2), parentStride - 2);
            const u = i / 2 - pi, v = j / 2 - pj;
            const a = pj * parentStride + pi, b = a + 1, c = a + parentStride, d = c + 1;
            waterIce[(j * (res + 1) + i) * 2 + 1] = Math.round(u + v <= 1
              ? parentIce[a] * (1 - u - v) + parentIce[b] * u + parentIce[c] * v
              : parentIce[b] * (1 - v) + parentIce[d] * (u + v - 1) + parentIce[c] * (1 - u));
          }
        }
      }
      if (waterIce) copySkirtMorph(waterIce, res, 2);
      buildSkirt(waterPositions, waterNormals, waterNormals, res, radiusKm / tiles, centerKm, radiusKm);
    }
  }

  return { centerKm, positions, normals, colors, morph, waterPositions, waterNormals, waterMorph, waterIce };
}

/** Same b-c diagonal as the actual ground and fluid index buffers. */
function writeParentMorph(points: Float32Array, parent: Float64Array, res: number, out: Float32Array, stride: number): void {
  const parentStride = res / 2 + 1;
  for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
    const pi = Math.min(Math.floor(i / 2), parentStride - 2);
    const pj = Math.min(Math.floor(j / 2), parentStride - 2);
    const u = i / 2 - pi, v = j / 2 - pj;
    const a = (pj * parentStride + pi) * 3, b = a + 3, c = a + parentStride * 3, d = c + 3;
    const index = j * (res + 1) + i;
    for (let axis = 0; axis < 3; axis++) {
      const value = u + v <= 1
        ? parent[a + axis] * (1 - u - v) + parent[b + axis] * u + parent[c + axis] * v
        : parent[b + axis] * (1 - v) + parent[d + axis] * (u + v - 1) + parent[c + axis] * (1 - u);
      out[index * stride + axis] = points[index * 3 + axis] - value;
    }
  }
}

function copySkirtMorph(morph: Float32Array | Uint8Array, res: number, components: number): void {
  const stride = res + 1, gridCount = stride * stride;
  for (let side = 0; side < 4; side++) for (let k = 0; k <= res; k++) {
    const source = (side === 0 ? k : side === 1 ? res * stride + k : side === 2 ? k * stride : k * stride + res) * components;
    const target = (gridCount + side * stride + k) * components;
    for (let c = 0; c < components; c++) morph[target + c] = morph[source + c];
  }
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
      const i11 = ((j + 1) * ext + i + 1) * 3;
      for (const [p, q, r] of [[i00, i10, i01], [i10, i11, i01]]) {
        for (let k = 0; k < 3; k++) {
          a[k] = positions[q + k] - positions[p + k];
          b[k] = positions[r + k] - positions[p + k];
        }
        const nx = a[1] * b[2] - a[2] * b[1];
        const ny = a[2] * b[0] - a[0] * b[2];
        const nz = a[0] * b[1] - a[1] * b[0];
        for (const corner of [p, q, r]) {
          normals[corner] += nx;
          normals[corner + 1] += ny;
          normals[corner + 2] += nz;
        }
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
  // Keep skirts proportional down to walking scale. A 50 m minimum
  // made meter-sized tiles carry giant vertical curtains underneath.
  const depthKm = Math.max(chunkSizeKm * 0.08, 0.00005);
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
