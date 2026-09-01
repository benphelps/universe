import { ClampToEdgeWrapping, DataTexture, FloatType, LinearFilter, RedFormat } from 'three';
import {
  dustScatterTable,
  SCATTER_TABLE_MUS,
  SCATTER_TABLE_TAUS,
} from '../../universe/galaxy/dustScattering';

let memo: DataTexture | null = null;

/** The multiple-scattering table as a texture: optical depth on the
 *  log x-axis, scattering angle on y. Solved once per session — the
 *  successive-orders sweep measures ~33 ms — and shared by every
 *  nebula volume's material. */
export function scatterTableTexture(): DataTexture {
  if (memo) return memo;
  memo = new DataTexture(
    dustScatterTable(),
    SCATTER_TABLE_TAUS,
    SCATTER_TABLE_MUS,
    RedFormat,
    FloatType,
  );
  memo.minFilter = LinearFilter;
  memo.magFilter = LinearFilter;
  memo.wrapS = ClampToEdgeWrapping;
  memo.wrapT = ClampToEdgeWrapping;
  memo.needsUpdate = true;
  return memo;
}
