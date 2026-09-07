import type { Vec3 } from '../../core/math/vec3';
import { localSurfaceTemperatureK, type SurfaceParams } from './params';
import { WATER_TRIPLE_K } from '../planet/waterPhase';

/** Persistent ice on an existing water basin. The narrow transition is
 * a visual mixed-area approximation around pure-water freezing, not a
 * latent-heat or seasonal thickness solve. Both preview and worker tiles
 * sample the same immutable annual temperature at the water's height. */
export function waterIceFraction(params: SurfaceParams, direction: Vec3, waterHeightM: number): number {
  if (!params.surfaceIce || params.magmaCoverage > 0) return 0;
  const temperature = localSurfaceTemperatureK(params, direction, waterHeightM);
  const t = Math.min(1, Math.max(0, (WATER_TRIPLE_K + 1 - temperature) / 2));
  return t * t * (3 - 2 * t);
}
