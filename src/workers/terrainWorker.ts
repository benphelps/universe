import { buildChunkMesh } from '../universe/surface/chunkMesh';
import { createSurfaceField, type SurfaceField } from '../universe/surface/field';
import type { TerrainRequest, TerrainResponse } from './protocol';

/**
 * Terrain generation off the frame loop: one field per initialized
 * planet, chunk meshes built on demand and returned via transferables.
 */
let field: SurfaceField | null = null;

self.onmessage = (event: MessageEvent<TerrainRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    field = createSurfaceField(message.seedHex, message.physical);
    return;
  }
  if (!field) return;
  const mesh = buildChunkMesh(field, message.face, message.level, message.x, message.y, message.res);
  const response: TerrainResponse = {
    id: message.id,
    centerKm: mesh.centerKm,
    positions: mesh.positions,
    normals: mesh.normals,
    colors: mesh.colors,
    waterPositions: mesh.waterPositions,
    waterNormals: mesh.waterNormals,
  };
  const transfers = [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer];
  if (mesh.waterPositions && mesh.waterNormals) {
    transfers.push(mesh.waterPositions.buffer, mesh.waterNormals.buffer);
  }
  (self as unknown as Worker).postMessage(response, transfers);
};
