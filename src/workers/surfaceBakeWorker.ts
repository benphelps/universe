import type { Characterization } from '../universe/planet/types';
import { createSurfaceField } from '../universe/surface/field';
import { bakeSurfaceCube } from '../universe/surface/surfaceBake';

export interface SurfaceBakeRequest {
  id: number;
  seedHex: string;
  physical: Characterization;
  size: number;
}

export interface SurfaceBakeResponse {
  id: number;
  size: number;
  faces: Uint8Array[];
}

/** Distant-appearance bakes off the frame loop: each request builds the
 *  body's real field (rivers skipped — sub-texel from orbit) and
 *  rasters the six cube faces. */
self.onmessage = (event: MessageEvent<SurfaceBakeRequest>) => {
  const { id, seedHex, physical, size } = event.data;
  const field = createSurfaceField(seedHex, physical, { rivers: false });
  const faces = bakeSurfaceCube(field, size, physical.appearance.oceanColor);
  const response: SurfaceBakeResponse = { id, size, faces };
  (self as unknown as Worker).postMessage(
    response,
    faces.map((face) => face.buffer),
  );
};
