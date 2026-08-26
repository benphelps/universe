import { createAsteroidField } from '../universe/surface/asteroidField';
import { buildChunkMesh } from '../universe/surface/chunkMesh';
import { createSurfaceField, type SurfaceField } from '../universe/surface/field';
import { scatterForChunk } from '../universe/surface/scatter';
import type { TerrainRequest, TerrainResponse } from './protocol';

/**
 * Terrain generation off the frame loop: one field per initialized
 * body, chunk meshes built on demand and returned via transferables.
 */
let field: SurfaceField | null = null;

self.onmessage = (event: MessageEvent<TerrainRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    field = createSurfaceField(message.seedHex, message.physical);
    return;
  }
  if (message.type === 'init-asteroid') {
    field = createAsteroidField(message.asteroid);
    return;
  }
  if (!field) return;
  const mesh = buildChunkMesh(field, message.face, message.level, message.x, message.y, message.res);
  const scatter = scatterForChunk(
    field,
    message.face,
    message.level,
    message.x,
    message.y,
    mesh.centerKm,
  );
  const response: TerrainResponse = {
    id: message.id,
    centerKm: mesh.centerKm,
    positions: mesh.positions,
    normals: mesh.normals,
    colors: mesh.colors,
    morph: mesh.morph,
    waterPositions: mesh.waterPositions,
    waterNormals: mesh.waterNormals,
    scatter,
  };
  const transfers = [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer, mesh.morph.buffer];
  if (mesh.waterPositions && mesh.waterNormals) {
    transfers.push(mesh.waterPositions.buffer, mesh.waterNormals.buffer);
  }
  if (scatter) transfers.push(scatter.buffer);
  (self as unknown as Worker).postMessage(response, transfers);
};
