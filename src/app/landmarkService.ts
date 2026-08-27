import type { GalacticLandmark } from '../universe/galaxy/regions';

/**
 * The one landmark catalog, built once in a worker at startup: the
 * galaxy's named complexes as travel destinations. `landmarksNow`
 * answers synchronously once the build lands.
 */
let promise: Promise<GalacticLandmark[]> | null = null;
let resolved: GalacticLandmark[] | null = null;

export function getGalacticLandmarks(): Promise<GalacticLandmark[]> {
  if (promise) return promise;
  promise = new Promise((resolve) => {
    const worker = new Worker(new URL('../workers/landmarksWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<GalacticLandmark[]>) => {
      resolved = event.data;
      worker.terminate();
      resolve(event.data);
    };
    worker.postMessage(0);
  });
  return promise;
}

export function landmarksNow(): GalacticLandmark[] | null {
  return resolved;
}
