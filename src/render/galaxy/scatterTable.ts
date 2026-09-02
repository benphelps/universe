import { ClampToEdgeWrapping, DataTexture, FloatType, LinearFilter, RedFormat } from 'three';
import {
  dustScatterTable,
  SCATTER_TABLE_MUS,
  SCATTER_TABLE_TAUS,
  singleScatterTable,
} from '../../universe/galaxy/dustScattering';

let memo: DataTexture | null = null;

/** The multiple-scattering table as a texture: optical depth on the
 *  log x-axis, scattering angle on y, shared by every nebula volume's
 *  material. It stands up at once carrying single scattering alone —
 *  the analytic first order — while a worker solves the full table,
 *  and takes the solved orders the moment they land; where no worker
 *  can be had it is solved here. */
export function scatterTableTexture(): DataTexture {
  if (memo) return memo;
  const solvable = typeof Worker !== 'undefined';
  memo = new DataTexture(
    solvable ? singleScatterTable() : dustScatterTable(),
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
  if (solvable) {
    const texture = memo;
    const worker = new Worker(new URL('../../workers/scatterTableWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<Float32Array>) => {
      texture.image.data = event.data;
      texture.needsUpdate = true;
      worker.terminate();
    };
    worker.postMessage(null);
  }
  return memo;
}
