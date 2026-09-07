import type { SkyField } from '../../universe/galaxy/skyfield';
import { rotateToScene } from '../../universe/galaxy/orientation';
import { PointConeIndex, type PointConeIndexData } from '../picking/pointConeIndex';

export interface SkyDrawing {
  positions: Float32Array;
  colors: Float32Array;
  luminosities: Float32Array;
  radii: Float32Array;
  index: PointConeIndexData;
}

/** Build under the sky worker's assembly permit. The viewer only wraps
 * ready buffers in attributes and adopts the ready picking index. */
export function prepareSkyDrawing(sky: SkyField): SkyDrawing {
  const count = sky.starCount - sky.nearStarCount;
  const positions = new Float32Array(count * 3);
  const luminosities = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const s = sky.nearStarCount + i, d = sky.starDistances[s];
    const [x, y, z] = rotateToScene(sky.sceneFromGalaxy, sky.starDirs[s * 3] * d,
      sky.starDirs[s * 3 + 1] * d, sky.starDirs[s * 3 + 2] * d);
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    luminosities[i] = sky.starBrightness[s] * d * d;
  }
  return { positions, colors: sky.starColors.slice(sky.nearStarCount * 3), luminosities,
    radii: new Float32Array(count), index: new PointConeIndex(positions, count).toData() };
}

export function skyDrawingTransfers(drawing: SkyDrawing): ArrayBuffer[] {
  return [drawing.positions.buffer, drawing.colors.buffer, drawing.luminosities.buffer, drawing.radii.buffer,
    drawing.index.indices.buffer, drawing.index.bounds.buffer, drawing.index.branches.buffer] as ArrayBuffer[];
}
