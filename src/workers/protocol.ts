import type { Characterization } from '../universe/planet/types';

/** Main thread → worker. */
export type TerrainRequest =
  | { type: 'init'; seedHex: string; physical: Characterization }
  | { type: 'chunk'; id: number; face: number; level: number; x: number; y: number; res: number };

/** Worker → main thread (arrays transferred, not copied). */
export interface TerrainResponse {
  id: number;
  centerKm: [number, number, number];
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Sea-surface tile on the same grid, present when the tile touches water. */
  waterPositions: Float32Array | null;
  waterNormals: Float32Array | null;
}
