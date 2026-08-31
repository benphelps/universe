import type { Characterization } from '../universe/planet/types';
import type { GridSurvey } from '../universe/surface/field';
import type { Asteroid } from '../universe/smallbody/types';

/** Field selection for a terrain worker: a planet or a small body.
 *  Planet workers either build and report the one shared grid survey,
 *  or defer that work until the coordinator installs the result. */
export type TerrainInit =
  | {
      type: 'init';
      seedHex: string;
      physical: Characterization;
      survey?: 'report' | 'defer';
    }
  | { type: 'init-asteroid'; asteroid: Asteroid };

/** Main thread → worker. */
export type TerrainRequest =
  | TerrainInit
  | { type: 'install-survey'; survey: GridSurvey | null }
  | { type: 'chunk'; id: number; face: number; level: number; x: number; y: number; res: number };

/** Worker → main thread (arrays transferred, not copied). */
export type TerrainResponse =
  | ChunkResponse
  | { type: 'survey'; survey: GridSurvey | null };

export interface ChunkResponse {
  type: 'chunk';
  id: number;
  centerKm: [number, number, number];
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Per-vertex (delta above parent LOD km, tile edge km) for geomorphing. */
  morph: Float32Array;
  /** Sea-surface tile on the same grid, present when the tile touches water. */
  waterPositions: Float32Array | null;
  waterNormals: Float32Array | null;
  /** Packed surface-scatter instances (see SCATTER_STRIDE), tile-size gated. */
  scatter: Float32Array | null;
}
